import express from 'express';
import {createServer} from 'node:http';
import type {Socket as NetSocket} from 'node:net';
import {localNetwork,isLoopback,peerIP,RateLimits} from './security.ts';
import {mediaStorage} from './media-storage.ts';
import {Server} from 'socket.io';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import {fileURLToPath} from 'node:url';
import {createHash,timingSafeEqual} from 'node:crypto';
import {act,addPlayer,createGame,view,tick,token} from './engine.ts';
import {openGameStore} from './storage.ts';
import type {Game,GameSummary} from '../shared/model.ts';
import {isQuestionFilled} from '../shared/model.ts';

export async function startServer(options:{port?:number;dataDir?:string;dev?:boolean;quiet?:boolean;mediaDir?:string;limits?:{maxGames?:number;mediaBytes?:number;fileBytes?:number}}={}){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const dataDir=options.dataDir||process.env.DATA_DIR||path.join(root,'data');fs.mkdirSync(dataDir,{recursive:true});
  const mediaDir=options.mediaDir||path.join(root,'public/media');fs.mkdirSync(mediaDir,{recursive:true});
  const storage=openGameStore(dataDir,undefined,path.resolve(dataDir)===path.join(root,'data')?path.join(root,'examples/test-game.json'):undefined),games=storage.games;
  const dirty=new Set<string>();
  const network=localNetwork(),rates=new RateLimits();
  const caps={maxGames:100,mediaBytes:1024**3,fileBytes:100*1024**2,...options.limits};
  const app=express(),server=createServer(app),io=new Server(server,{maxHttpBufferSize:2e6,allowRequest:(req,done)=>{const port=(server.address()as{port:number})?.port;done(null,network.accepts(req,port)&&io.engine.clientsCount<128&&rates.take('socket:'+peerIP(req.socket.remoteAddress),60,60000));}});let saveHandle:ReturnType<typeof setTimeout>|null=null;let stopping=false;
  server.headersTimeout=15000;server.requestTimeout=120000;
  const connections=new Set<NetSocket>();
  server.on('connection',socket=>{connections.add(socket);socket.once('close',()=>connections.delete(socket));});
  const saveNow=()=>{for(const id of dirty){const game=games.get(id);if(game)storage.save(game);dirty.delete(id);}};
  const save=(game:Game)=>{dirty.add(game.id);if(stopping)return;if(saveHandle)clearTimeout(saveHandle);saveHandle=setTimeout(saveNow,150);};
  const summaries=():GameSummary[]=>[...games.values()].map(g=>({id:g.id,name:g.name,subtitle:g.subtitle,status:g.status,playerCount:g.players.length,questionTotal:g.rounds.reduce((total,r)=>total+r.categories.reduce((total,c)=>total+c.questions.filter(isQuestionFilled).length,0),0),rounds:g.rounds.length,accent:g.theme.accent,createdAt:g.createdAt,locked:!!g.settings.joinPin,hostClaimable:!!g.hostClaimable})).sort((a,b)=>b.createdAt-a.createdAt);
  const publish=(g:Game,removedMessage='You were removed from this game')=>{for(const s of io.sockets.sockets.values())if(s.data.gameId===g.id){if(s.data.role==='host'&&s.data.hostToken!==g.hostToken){s.emit('host-revoked','Host access was transferred to another browser.');s.data={};continue;}if(s.data.role==='player'&&!g.players.some(p=>p.id===s.data.playerId)){s.emit('revoked',removedMessage);s.data={};continue;}s.emit('state',view(g,s.data.role,s.data.playerId));}io.emit('games',summaries());save(g);};
  const game=(id:string)=>{const g=games.get(id.toUpperCase());if(!g)throw new Error('Game not found');return g;};
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    if(!network.accepts(req,(server.address()as{port:number})?.port)){res.status(403).json({error:'Access is limited to this computer and its selected LAN.'});return;}
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    if(req.path.startsWith('/api/')){
      res.setHeader('Cache-Control','no-store');
      const ip=peerIP(req.socket.remoteAddress);
      const sensitive=/\/(join|claim-host|host-transfer(?:\/accept)?)$/.test(req.path);
      if(!rates.take('api:'+ip,300,60000)||(sensitive&&req.method==='POST'&&!rates.take('access:'+ip,30,60000))){res.setHeader('Retry-After','60');res.status(429).json({error:'Too many requests. Try again in a minute.'});return;}
      if(!['GET','HEAD','DELETE','OPTIONS'].includes(req.method)&&!req.is('application/json')&&!req.is('multipart/form-data')){res.status(415).json({error:'Use JSON or a media upload.'});return;}
    }
    next();
  });
  app.use(express.json({limit:'2mb'}));
  const canCreate=(req:express.Request)=>isLoopback(req.socket.remoteAddress||'')||[...games.values()].some(g=>req.headers.authorization===`Bearer ${g.hostToken}`);
  app.get('/api/access',(req,res)=>res.json({canCreateGames:canCreate(req)}));
  const host=(req:express.Request)=>{const g=game(String(req.params.id));if(req.headers.authorization!==`Bearer ${g.hostToken}`)throw new Error('Host access required');return g;};
  // Save first, then publish/revoke. A disk error leaves the current host in control.
  const saveAccess=(g:Game,access:Partial<Pick<Game,'hostToken'|'hostTransfer'|'hostClaimable'>>)=>{
    const next={...g,...access,revision:g.revision+1};storage.save(next);Object.assign(g,next);dirty.delete(g.id);publish(g);
  };
  const transferHash=(value:string)=>createHash('sha256').update(value).digest('hex');
  const validSecret=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{48}$/.test(value);
  app.get('/api/health',(_req,res)=>res.json({ok:true,app:'jeopardy'}));
  app.get('/api/network',(_req,res)=>{const port=(server.address()as{port:number})?.port;res.json({port,addresses:network.lan?[`http://${network.lan.address}:${port}`]:[]});});
  app.get('/api/games',(_req,res)=>res.json(summaries()));
  app.post('/api/games',(req,res,next)=>{try{if(!canCreate(req)){res.status(403).json({error:'Create games on the host computer or in a browser with host access.'});return;}if(games.size>=caps.maxGames){res.status(409).json({error:'Game storage limit reached. Delete an unused game first.'});return;}if(!rates.take('create:'+peerIP(req.socket.remoteAddress),20,3600000)){res.status(429).json({error:'Too many games created. Try again later.'});return;}const g=createGame(req.body);games.set(g.id,g);publish(g);res.status(201).json({id:g.id,hostToken:g.hostToken});}catch(e){next(e);}});
  app.get('/api/games/:id',(req,res,next)=>{try{res.json(view(game(String(req.params.id)),'stage'));}catch(e){next(e);}});
  app.post('/api/games/:id/join',(req,res,next)=>{try{const g=game(String(req.params.id));if(req.body.token){const p=g.players.find(p=>p.token===req.body.token);if(p){res.json({playerId:p.id,token:p.token});return;}}if(g.settings.joinPin&&g.settings.joinPin!==req.body.pin)throw new Error('Incorrect room PIN');const p=addPlayer(g,String(req.body.name||''));publish(g);res.json({playerId:p.id,token:p.token});}catch(e){next(e);}});
  app.post('/api/games/:id/claim-host',(req,res,next)=>{
    try{
      if(!req.is('application/json'))throw new Error('Host access requires a JSON request');
      const address=req.socket.remoteAddress||'';
      if(address!=='::1'&&!/^(::ffff:)?127\./.test(address))throw new Error('Host access can only be claimed on this computer');
      const g=game(String(req.params.id));
      if(!g.hostClaimable)throw new Error('Host access has already been claimed');
      g.hostClaimable=false;publish(g);saveNow();
      res.json({hostToken:g.hostToken});
    }catch(error){next(error);}
  });
  app.get('/api/games/:id/host-transfer',(req,res,next)=>{
    try{const g=host(req);res.setHeader('Cache-Control','no-store');res.json({expiresAt:g.hostTransfer&&g.hostTransfer.expiresAt>Date.now()?g.hostTransfer.expiresAt:null});}catch(error){next(error);}
  });
  app.post('/api/games/:id/host-transfer',(req,res,next)=>{
    try{
      const g=host(req),secret=token(),expiresAt=Date.now()+10*60*1000;
      saveAccess(g,{hostTransfer:{tokenHash:transferHash(secret),expiresAt}});
      res.setHeader('Cache-Control','no-store');res.json({transferToken:secret,expiresAt});
    }catch(error){next(error);}
  });
  app.delete('/api/games/:id/host-transfer',(req,res,next)=>{
    try{const g=host(req);saveAccess(g,{hostTransfer:null});res.json({ok:true});}catch(error){next(error);}
  });
  app.post('/api/games/:id/host-transfer/accept',(req,res,next)=>{
    try{
      const g=game(String(req.params.id)),{transferToken,hostToken}=req.body;
      if(!validSecret(transferToken)||!validSecret(hostToken)||transferToken===hostToken)throw new Error('Invalid host transfer link');
      // The receiver saves its randomly generated key before sending this request.
      // Retrying with that same key is safe even if the first response was lost.
      if(g.hostToken===hostToken){res.setHeader('Cache-Control','no-store');res.json({ok:true});return;}
      const transfer=g.hostTransfer;
      if(!transfer||transfer.expiresAt<=Date.now()||!timingSafeEqual(Buffer.from(transfer.tokenHash,'hex'),Buffer.from(transferHash(transferToken),'hex')))throw new Error('This host transfer link has expired, was cancelled, or has already been used.');
      saveAccess(g,{hostToken,hostTransfer:null,hostClaimable:false});
      res.setHeader('Cache-Control','no-store');res.json({ok:true});
    }catch(error){next(error);}
  });
  app.delete('/api/games/:id',(req,res,next)=>{
    try{
      const g=host(req);
      storage.remove(g.id);dirty.delete(g.id);
      for(const socket of io.sockets.sockets.values())if(socket.data.gameId===g.id){
        socket.emit('deleted','This game was deleted by the host.');socket.data={};
      }
      io.emit('games',summaries());
      res.json({ok:true,id:g.id});
    }catch(error){next(error);}
  });
  app.get('/api/games/:id/export',(req,res,next)=>{try{const g=host(req);res.json({format:'jeopardy/1',name:g.name,subtitle:g.subtitle,rounds:g.rounds,settings:g.settings,theme:g.theme});}catch(e){next(e);}});
  const extensions:Record<string,string>={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','video/mp4':'.mp4','video/webm':'.webm','audio/mpeg':'.mp3','audio/wav':'.wav','audio/x-wav':'.wav','audio/ogg':'.ogg','video/ogg':'.ogv'};
  const upload=multer({storage:mediaStorage(mediaDir,caps.mediaBytes,extensions),limits:{fileSize:caps.fileBytes,files:1,fields:0,parts:1},fileFilter:(_req,file,cb)=>{if(!extensions[file.mimetype])cb(new Error('Use PNG, JPEG, WebP, GIF, MP4, WebM, MP3, WAV or OGG'));else cb(null,true);}});
  app.post('/api/games/:id/media',(req,res,next)=>{try{
    const g=host(req);if(g.status!=='lobby')throw new Error('This game has started. Make a copy to edit it.');
    if(!rates.take('upload:'+peerIP(req.socket.remoteAddress),10,60000)){res.status(429).json({error:'Too many uploads. Try again in a minute.'});return;}
    const declared=Number(req.headers['content-length']);
    if(Number.isFinite(declared)&&declared>caps.fileBytes+1024*1024){res.status(413).json({error:'Upload exceeds the file size limit.'});return;}
    upload.single('file')(req,res,error=>{
      if(error){next(error);return;}
      if(!req.file){res.status(400).json({error:'Select a file'});return;}
      res.json({url:`/media/${req.file.filename}`,type:req.file.mimetype});
    });
  }catch(e){next(e);}});
  app.use('/media',express.static(mediaDir,{setHeaders:res=>res.setHeader('Cache-Control','public, max-age=31536000, immutable')}));
  app.use('/api',(_req,res)=>res.status(404).json({error:'Not found'}));
  app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status((error as Error&{status?:number}).status|| (error instanceof multer.MulterError&&error.code==='LIMIT_FILE_SIZE'?413:error.message==='Game not found'?404:error.message.includes('access')?403:400)).json({error:error.message}));
  io.on('connection',s=>{
    s.use(([event],next)=>{if(!rates.take('messages:'+s.id,60,1000)){s.emit('error','Too many actions');s.disconnect(true);next(new Error('Too many actions'));return;}next();});
    s.emit('games',summaries());
    s.on('subscribe',(input:{gameId:string;role:'host'|'player'|'stage';token?:string},ack:(v:unknown)=>void)=>{try{const g=game(input.gameId);if(!['host','player','stage'].includes(input.role))throw new Error('Unknown role');if(input.role==='host'&&input.token!==g.hostToken)throw new Error('Host key is missing or invalid');const p=input.role==='player'?g.players.find(p=>p.token===input.token):undefined;if(input.role==='player'&&!p)throw new Error('Join the game first');s.data={gameId:g.id,role:input.role,playerId:p?.id,hostToken:input.role==='host'?input.token:undefined};if(p)p.connected=true;s.emit('state',view(g,input.role,p?.id));publish(g);ack?.({ok:true});}catch(e){ack?.({ok:false,error:(e as Error).message});}});
    s.on('command',(input:{action:string;data?:Record<string,unknown>},ack:(v:unknown)=>void)=>{try{const g=game(s.data.gameId||'');if(!['host','player'].includes(s.data.role))throw new Error('Join as a host or player');if(s.data.role==='host'&&s.data.hostToken!==g.hostToken)throw new Error('Host access was transferred');act(g,input.action,input.data||{},s.data.role,s.data.playerId||null);publish(g,input.action==='reset'?'The host reset this game. Join again to play.':undefined);ack?.({ok:true});}catch(e){const g=games.get(s.data.gameId);if(g)publish(g);ack?.({ok:false,error:(e as Error).message});}});
    s.on('disconnect',()=>{const g=games.get(s.data.gameId);if(!g)return;const p=g.players.find(p=>p.id===s.data.playerId);if(p&&!Array.from(io.sockets.sockets.values()).some(other=>other.data.gameId===g.id&&other.data.playerId===p.id))p.connected=false;publish(g);});
  });
  const interval=setInterval(()=>{for(const g of games.values())if(tick(g))publish(g);},100);
  const dev=options.dev??process.env.NODE_ENV==='development';let vite:Awaited<ReturnType<typeof import('vite')['createServer']>>|undefined;
  if(dev){const{createServer:createVite}=await import('vite');vite=await createVite({root,server:{middlewareMode:true,ws:{server},fs:{deny:[
    '.env','.env.*','*.{crt,pem,key,p12,pfx,cer,der}','.npmrc','.yarnrc.yml','**/.git/**',
    ...[path.resolve(dataDir),fs.realpathSync(dataDir)].map(directory=>directory.split(path.sep).join('/')+'/**'),
  ]}},appType:'spa'});app.use(vite.middlewares);}else{app.use(express.static(path.join(root,'dist')));app.use((_req,res)=>res.sendFile(path.join(root,'dist/index.html')));}
  const port=options.port??Number(process.env.PORT||43187);await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',()=>resolve());});
  if(!options.quiet){const p=(server.address()as{port:number}).port;console.log(`\n  Jeopardy → http://localhost:${p}`);if(network.lan)console.log(`  LAN      → http://${network.lan.address}:${p} (${network.lan.name})`);else console.log('  Local only: no private LAN interface found.');console.log();}
  let closing:Promise<void>|undefined;
  const close=()=>{
    if(closing)return closing;
    stopping=true;
    clearInterval(interval);
    if(saveHandle)clearTimeout(saveHandle);
    // Flush acknowledged commands before any asynchronous shutdown or watcher restart.
    saveNow();
    closing=(async()=>{
      // Close both websocket servers together; neither should wait on the other's clients.
      const deadline=setTimeout(()=>{for(const socket of connections)socket.destroy();},1000).unref();
      try{await Promise.all([vite?.close(),io.close()]);}
      finally{clearTimeout(deadline);saveNow();}
    })();
    return closing;
  };
  return{app,io,server,games,close};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const instance=await startServer();let closing=false;const close=()=>{if(closing)return;closing=true;instance.close().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});};process.once('SIGINT',close);process.once('SIGTERM',close);
}

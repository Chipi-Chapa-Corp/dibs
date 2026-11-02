import express from 'express';
import {createServer} from 'node:http';
import type {Socket as NetSocket} from 'node:net';
import {Server} from 'socket.io';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import multer from 'multer';
import {fileURLToPath} from 'node:url';
import {act,addPlayer,createGame,view,tick,token} from './engine.ts';
import {openGameStore} from './storage.ts';
import type {Game,GameSummary} from '../shared/model.ts';
import {isQuestionFilled} from '../shared/model.ts';

export async function startServer(options:{port?:number;dataDir?:string;dev?:boolean;quiet?:boolean}={}){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const dataDir=options.dataDir||process.env.DATA_DIR||path.join(root,'data');fs.mkdirSync(dataDir,{recursive:true});
  const mediaDir=path.join(root,'public/media');fs.mkdirSync(mediaDir,{recursive:true});
  const storage=openGameStore(dataDir,undefined,path.resolve(dataDir)===path.join(root,'data')?path.join(root,'examples/test-game.json'):undefined),games=storage.games;
  const dirty=new Set<string>();
  const app=express(),server=createServer(app),io=new Server(server,{maxHttpBufferSize:2e6});let saveHandle:ReturnType<typeof setTimeout>|null=null;let stopping=false;
  const connections=new Set<NetSocket>();
  server.on('connection',socket=>{connections.add(socket);socket.once('close',()=>connections.delete(socket));});
  const saveNow=()=>{for(const id of dirty){const game=games.get(id);if(game)storage.save(game);dirty.delete(id);}};
  const save=(game:Game)=>{dirty.add(game.id);if(stopping)return;if(saveHandle)clearTimeout(saveHandle);saveHandle=setTimeout(saveNow,150);};
  const summaries=():GameSummary[]=>[...games.values()].map(g=>({id:g.id,name:g.name,subtitle:g.subtitle,status:g.status,playerCount:g.players.length,questionTotal:g.rounds.reduce((total,r)=>total+r.categories.reduce((total,c)=>total+c.questions.filter(isQuestionFilled).length,0),0),rounds:g.rounds.length,accent:g.theme.accent,createdAt:g.createdAt,locked:!!g.settings.joinPin,hostClaimable:!!g.hostClaimable})).sort((a,b)=>b.createdAt-a.createdAt);
  const publish=(g:Game,removedMessage='You were removed from this game')=>{for(const s of io.sockets.sockets.values())if(s.data.gameId===g.id){if(s.data.role==='player'&&!g.players.some(p=>p.id===s.data.playerId)){s.emit('revoked',removedMessage);s.data={};continue;}s.emit('state',view(g,s.data.role,s.data.playerId));}io.emit('games',summaries());save(g);};
  const game=(id:string)=>{const g=games.get(id.toUpperCase());if(!g)throw new Error('Game not found');return g;};
  app.use(express.json({limit:'2mb'}));app.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');next();});
  const host=(req:express.Request)=>{const g=game(String(req.params.id));if(req.headers.authorization!==`Bearer ${g.hostToken}`)throw new Error('Host access required');return g;};
  app.get('/api/health',(_req,res)=>res.json({ok:true,app:'jeopardy'}));
  app.get('/api/network',(_req,res)=>{const port=(server.address()as{port:number})?.port;res.json({port,addresses:Object.values(os.networkInterfaces()).flat().filter((i):i is os.NetworkInterfaceInfo=>!!i&&!i.internal&&i.family==='IPv4').map(i=>`http://${i.address}:${port}`)});});
  app.get('/api/games',(_req,res)=>res.json(summaries()));
  app.post('/api/games',(req,res,next)=>{try{const g=createGame(req.body);games.set(g.id,g);publish(g);res.status(201).json({id:g.id,hostToken:g.hostToken});}catch(e){next(e);}});
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
  const upload=multer({storage:multer.diskStorage({destination:mediaDir,filename:(_req,file,cb)=>cb(null,token()+extensions[file.mimetype])}),limits:{fileSize:100*1024*1024},fileFilter:(_req,file,cb)=>{if(!extensions[file.mimetype])cb(new Error('Use PNG, JPEG, WebP, GIF, MP4, WebM, MP3, WAV or OGG'));else cb(null,true);}});
  app.post('/api/games/:id/media',(req,res,next)=>{try{const g=host(req);if(g.status!=='lobby')throw new Error('This game has started. Make a copy to edit it.');next();}catch(e){next(e);}},upload.single('file'),(req,res)=>{if(!req.file){res.status(400).json({error:'Select a file'});return;}res.json({url:`/media/${req.file.filename}`,type:req.file.mimetype});});
  app.use('/media',express.static(mediaDir,{setHeaders:res=>res.setHeader('Cache-Control','public, max-age=31536000, immutable')}));
  app.use('/api',(_req,res)=>res.status(404).json({error:'Not found'}));
  app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error.message==='Game not found'?404:error.message.includes('access')?403:400).json({error:error.message}));
  io.on('connection',s=>{
    s.emit('games',summaries());
    s.on('subscribe',(input:{gameId:string;role:'host'|'player'|'stage';token?:string},ack:(v:unknown)=>void)=>{try{const g=game(input.gameId);if(!['host','player','stage'].includes(input.role))throw new Error('Unknown role');if(input.role==='host'&&input.token!==g.hostToken)throw new Error('Host key is missing or invalid');const p=input.role==='player'?g.players.find(p=>p.token===input.token):undefined;if(input.role==='player'&&!p)throw new Error('Join the game first');s.data={gameId:g.id,role:input.role,playerId:p?.id};if(p)p.connected=true;s.emit('state',view(g,input.role,p?.id));publish(g);ack?.({ok:true});}catch(e){ack?.({ok:false,error:(e as Error).message});}});
    s.on('command',(input:{action:string;data?:Record<string,unknown>},ack:(v:unknown)=>void)=>{try{const g=game(s.data.gameId||'');if(!['host','player'].includes(s.data.role))throw new Error('Join as a host or player');act(g,input.action,input.data||{},s.data.role,s.data.playerId||null);publish(g,input.action==='reset'?'The host reset this game. Join again to play.':undefined);ack?.({ok:true});}catch(e){const g=games.get(s.data.gameId);if(g)publish(g);ack?.({ok:false,error:(e as Error).message});}});
    s.on('disconnect',()=>{const g=games.get(s.data.gameId);if(!g)return;const p=g.players.find(p=>p.id===s.data.playerId);if(p&&!Array.from(io.sockets.sockets.values()).some(other=>other.data.gameId===g.id&&other.data.playerId===p.id))p.connected=false;publish(g);});
  });
  const interval=setInterval(()=>{for(const g of games.values())if(tick(g))publish(g);},100);
  const dev=options.dev??process.env.NODE_ENV!=='production';let vite:Awaited<ReturnType<typeof import('vite')['createServer']>>|undefined;
  if(dev){const{createServer:createVite}=await import('vite');vite=await createVite({root,server:{middlewareMode:true,ws:{server},fs:{deny:[
    '.env','.env.*','*.{crt,pem,key,p12,pfx,cer,der}','.npmrc','.yarnrc.yml','**/.git/**',
    ...[path.resolve(dataDir),fs.realpathSync(dataDir)].map(directory=>directory.split(path.sep).join('/')+'/**'),
  ]}},appType:'spa'});app.use(vite.middlewares);}else{app.use(express.static(path.join(root,'dist')));app.use((_req,res)=>res.sendFile(path.join(root,'dist/index.html')));}
  const port=options.port??Number(process.env.PORT||43187);await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'::',()=>resolve());});
  if(!options.quiet){const p=(server.address()as{port:number}).port;console.log(`\n  Jeopardy → http://localhost:${p}`);for(const i of Object.values(os.networkInterfaces()).flat())if(i&&!i.internal&&i.family==='IPv4')console.log(`  LAN      → http://${i.address}:${p}`);console.log();}
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {io,Socket} from 'socket.io-client';
import {startServer} from '../server/index.ts';
import {createGame,addPlayer,view} from '../server/engine.ts';
import {demoRounds} from '../shared/model.ts';
import type {GameView} from '../shared/model.ts';
const once=(s:Socket,event:string)=>new Promise<any>(resolve=>s.once(event,resolve));
const emit=(s:Socket,event:string,data:unknown)=>new Promise<any>((resolve,reject)=>s.timeout(3000).emit(event,data,(err:Error,result:unknown)=>err?reject(err):resolve(result)));
test('Daily Double host assignment, phone wager and mandatory answer synchronize across real clients',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-daily-network-')),server=await startServer({port:0,dataDir:dir,dev:false,quiet:true}),sockets:Socket[]=[];
 try{
  const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const post=async(path:string,data:unknown)=>(await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).json();
  const rounds=demoRounds();rounds[0].categories[0].questions[0].dailyDouble=true;
  const created=await post('/api/games',{name:'Daily Double network',definition:{rounds}}),a=await post(`/api/games/${created.id}/join`,{name:'Choosing team'}),b=await post(`/api/games/${created.id}/join`,{name:'Required team'});
  const connect=async(role:string,token?:string)=>{const s=io(base,{autoConnect:false,transports:['websocket']});sockets.push(s);let latest:GameView;s.on('state',v=>latest=v);s.connect();await once(s,'connect');assert((await emit(s,'subscribe',{gameId:created.id,role,token})).ok);return{s,state:()=>latest!};};
  const host=await connect('host'),selecting=await connect('player',a.token),answering=await connect('player',b.token),stage=await connect('stage');
  const command=(s:Socket,action:string,data?:unknown)=>emit(s,'command',{action,data});
  await command(host.s,'start');await command(host.s,'openQuestion',{questionId:rounds[0].categories[0].questions[0].id});
  await command(host.s,'assignDailyDouble',{fromId:a.playerId,playerId:b.playerId});
  await waitState(answering,v=>v.current?.answeringId===b.playerId);assert.equal(answering.state().current?.dailyDoubleFromId,a.playerId);
  assert.equal((await command(selecting.s,'wager',{wager:750})).ok,false);
  assert.equal((await command(answering.s,'wager',{wager:750})).ok,true);
  await waitState(host,v=>v.current?.wagers[b.playerId]?.wager===750);await waitState(stage,v=>v.current?.wagers[b.playerId]?.wager===750);
  assert.equal(stage.state().currentQuestion?.prompt,'');assert.equal(answering.state().yourFinal?.wager,750);
  await command(host.s,'finalBegin');await waitState(stage,v=>v.current?.phase==='question');
  assert.equal(stage.state().currentQuestion?.prompt,rounds[0].categories[0].questions[0].prompt);assert.equal(stage.state().current?.buzzOpen,false);
  assert.equal((await command(selecting.s,'buzz')).ok,false);assert.equal((await command(host.s,'answerer',{playerId:a.playerId})).ok,false);
  assert.equal((await command(host.s,'judge',{correct:false})).ok,true);
  await waitState(stage,v=>v.players.find(p=>p.id===b.playerId)?.score===-750);
  assert.equal(stage.state().players.find(p=>p.id===a.playerId)?.score,0);assert(stage.state().current?.closed);
 }finally{sockets.forEach(s=>s.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});
async function waitState(client:{s:Socket;state:()=>GameView},predicate:(v:GameView)=>boolean){
 if(predicate(client.state()))return;
 await new Promise<void>((resolve,reject)=>{
  const timeout=setTimeout(()=>{client.s.off('state',changed);reject(new Error('Expected synchronized state did not arrive'));},3000);
  const changed=(v:GameView)=>{if(predicate(v)){clearTimeout(timeout);client.s.off('state',changed);resolve();}};
  client.s.on('state',changed);
 });
}
test('legacy room PINs and player limits are ignored when loading and importing games',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jeopardy-open-join-'));mkdirSync(join(dir,'games'));
 const game=createGame({name:'Legacy room'});
 Object.assign(game.settings,{joinPin:'2468',maxPlayers:1});
 writeFileSync(join(dir,'games',`${game.id}.json`),JSON.stringify(game));
 const server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});
 try{
  const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const post=(path:string,data:unknown)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const restored=server.games.get(game.id)!;
  assert(!('joinPin' in restored.settings));assert(!('maxPlayers' in restored.settings));
  for(let i=0;i<101;i++){
   const response=await post(`/api/games/${game.id}/join`,{name:`Player ${i}`});
   assert.equal(response.status,200);assert((await response.json()).token);
  }
  assert.equal(restored.players.length,101);
  const imported=await (await post('/api/games',{name:'Imported room',definition:{settings:{joinPin:'secret',maxPlayers:1}}})).json();
  const exported=await (await fetch(`${base}/api/games/${imported.id}/export`)).json();
  assert(!('joinPin' in exported.settings));assert(!('maxPlayers' in exported.settings));
  for(const name of ['Ada','Bea'])assert.equal((await post(`/api/games/${imported.id}/join`,{name})).status,200);
  const listed=await (await fetch(base+'/api/games')).json();
  assert(listed.every((summary:Record<string,unknown>)=>!('locked' in summary)));
 }finally{await server.close();rmSync(dir,{recursive:true,force:true});}
});
test('editing locks serialize editors, protect uploads, and hand off automatically when a tab leaves',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-edit-lock-'));const server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});const sockets:Socket[]=[];let uploaded:URL|undefined;
 try{
  const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const created=await (await fetch(base+'/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Shared game',definition:{rounds:demoRounds()}})})).json();
  const connect=async(editing=false)=>{
   const s=io(base,{autoConnect:false,transports:['websocket']});sockets.push(s);let latest:GameView;s.on('state',v=>latest=v);s.connect();await once(s,'connect');
   assert.equal((await emit(s,'subscribe',{gameId:created.id,role:'host',editing})).ok,true);return{s,state:()=>latest!};
  };
  const first=await connect(true),second=await connect(true),host=await connect();
  assert.equal(first.state().editLock,'mine');assert.equal(second.state().editLock,'other');
  assert.equal((await emit(first.s,'command',{action:'save',data:{name:'First editor’s work'}})).ok,true);
  for(const client of [second,host])assert.equal((await emit(client.s,'command',{action:'save',data:{name:'Must not overwrite'}})).ok,false);
  assert.equal((await emit(host.s,'command',{action:'start'})).ok,false);
  assert.equal((await fetch(`${base}/api/games/${created.id}`,{method:'DELETE'})).status,409);
  assert.equal((await fetch(`${base}/api/games/${created.id}/export`)).status,200);
  assert.equal((await fetch(`${base}/api/games/${created.id}/media`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,409);
  assert.equal((await fetch(`${base}/api/games/${created.id}/media`,{method:'POST',headers:{'X-Editor-Id':second.s.id!,'Content-Type':'application/json'},body:'{}'})).status,409);
  const form=new FormData();form.append('file',new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}),'fixture.png');
  const response=await fetch(`${base}/api/games/${created.id}/media`,{method:'POST',headers:{'X-Editor-Id':first.s.id!},body:form});assert.equal(response.status,200);
  const media=await response.json();uploaded=new URL('../public'+media.url,import.meta.url);assert(existsSync(uploaded));
  const staleEditorId=first.s.id!;first.s.disconnect();
  await waitState(second,v=>v.editLock==='mine');assert.equal(second.state().name,'First editor’s work');
  assert.equal((await fetch(`${base}/api/games/${created.id}/media`,{method:'POST',headers:{'X-Editor-Id':staleEditorId,'Content-Type':'application/json'},body:'{}'})).status,409);
  assert.equal((await emit(second.s,'command',{action:'save',data:{name:'Second editor’s work'}})).ok,true);
  assert.equal((await emit(second.s,'subscribe',{gameId:created.id,role:'host',editing:false})).ok,true);
  await waitState(host,v=>v.editLock===null);
  assert.equal((await emit(host.s,'command',{action:'start'})).ok,true);
  assert.equal((await emit(second.s,'command',{action:'pause'})).ok,true);
  assert.equal(server.games.get(created.id)!.name,'Second editor’s work');
  assert.equal((await fetch(`${base}/api/games/${created.id}`,{method:'DELETE'})).status,200);
 }finally{sockets.forEach(s=>s.disconnect());await server.close();if(uploaded)rmSync(uploaded,{force:true});rmSync(dir,{recursive:true,force:true});}
});
test('editing locks are per game, release on resubscription, and do not survive a server restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-edit-restart-'));let server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});const sockets:Socket[]=[];
 try{
  let base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const create=async(name:string)=>(await (await fetch(base+'/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})})).json()).id;
  const a=await create('Game A'),b=await create('Game B');
  const socket=io(base,{autoConnect:false,transports:['websocket']});sockets.push(socket);socket.connect();await once(socket,'connect');
  assert.equal((await emit(socket,'subscribe',{gameId:a,role:'host',editing:true})).ok,true);
  assert.equal((await emit(socket,'subscribe',{gameId:b,role:'host',editing:true})).ok,true);
  const listed=await (await fetch(base+'/api/games')).json();assert.equal(listed.find((g:{id:string})=>g.id===a).editing,false);assert.equal(listed.find((g:{id:string})=>g.id===b).editing,true);
  await server.close();server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const restored=await (await fetch(base+'/api/games')).json();assert(restored.every((g:{editing:boolean})=>!g.editing));
  assert.equal((await fetch(`${base}/api/games/${b}`,{method:'DELETE'})).status,200);
 }finally{sockets.forEach(s=>s.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});
test('real clients: discovery, open hosting, concurrent buzzes, synchronized scores, redaction, reconnect and persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jeopardy-test-'));const server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});let sockets:Socket[]=[];let restarted:Awaited<ReturnType<typeof startServer>>|null=null;
 try{const port=(server.server.address()as{port:number}).port;const base=`http://127.0.0.1:${port}`;const request=async(path:string,data?:unknown)=>{const r=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return r.json();};
 const rounds=demoRounds(),mystery=rounds[0].categories[0].questions[1];mystery.prompt='';mystery.modifier={title:'Trading places',instructions:'Swap your score with another team.'};
 const created=await request('/api/games',{name:'Network test',definition:{rounds}});const listed=await request('/api/games');assert.equal(listed[0].id,created.id);assert(!('hostToken' in created));
 const pa=await request(`/api/games/${created.id}/join`,{name:'Ada'}),pb=await request(`/api/games/${created.id}/join`,{name:'Bea'});const connect=async(role:string,token?:string)=>{const s=io(base,{transports:['websocket'],autoConnect:false});sockets.push(s);s.connect();await once(s,'connect');let state:GameView; s.on('state',v=>state=v);const sub=await emit(s,'subscribe',{gameId:created.id,role,token});return{s,sub,state:()=>state!};};
 const host=await connect('host'),a=await connect('player',pa.token),b=await connect('player',pb.token),stage=await connect('stage');assert(host.sub.ok&&a.sub.ok&&b.sub.ok&&stage.sub.ok);const anotherHost=await connect('host');assert.equal(anotherHost.sub.ok,true);
 assert.equal((await emit(a.s,'command',{action:'adjust',data:{playerId:pa.playerId,amount:99999}})).ok,false);
 const q=host.state().rounds[0].categories[0].questions[0];assert.equal(stage.state().rounds[0].categories[0].questions[0].answer,'');
 await emit(host.s,'command',{action:'start'});await emit(host.s,'command',{action:'selectQuestion',data:{questionId:q.id}});
 await waitState(stage,v=>v.selection?.questionId===q.id);await waitState(a,v=>v.selection?.questionId===q.id);
 assert.equal(stage.state().currentQuestion,null);assert.equal(a.state().current,null);assert.equal((await emit(a.s,'command',{action:'buzz'})).ok,false);
 await waitState(host,v=>v.current?.questionId===q.id&&!v.selection);
 await emit(host.s,'command',{action:'openBuzzers'});const results=await Promise.all([emit(a.s,'command',{action:'buzz'}),emit(b.s,'command',{action:'buzz'})]);assert.equal(results.filter(r=>r.ok).length,1);
 const winner=host.state().current!.answeringId!;await emit(host.s,'command',{action:'judge',data:{correct:true}});assert.equal(host.state().players.find(p=>p.id===winner)?.score,100);assert.equal(stage.state().currentQuestion?.answer,'');assert.equal(a.state().currentQuestion?.answer,'');
 const again=await request(`/api/games/${created.id}/join`,{token:pa.token,name:'Ada'});assert.equal(again.playerId,pa.playerId);assert.equal((await request(`/api/games/${created.id}`)).players.length,2);
 const json=JSON.stringify(stage.state());assert(!('hostToken' in stage.state()));assert(!json.includes(pa.token));
 await emit(host.s,'command',{action:'closeQuestion'});assert.equal((await emit(host.s,'command',{action:'save',data:{settings:{selection:'winner'}}})).ok,false);assert(!('selection' in host.state().settings));
 assert.equal((await emit(a.s,'command',{action:'selectQuestion',data:{questionId:mystery.id}})).ok,false);
 assert.equal((await emit(b.s,'command',{action:'selectQuestion',data:{questionId:mystery.id}})).ok,false);
 assert.equal((await emit(host.s,'command',{action:'openQuestion',data:{questionId:mystery.id}})).ok,true);
 await waitState(stage,v=>v.current?.questionId===mystery.id);await waitState(a,v=>v.current?.questionId===mystery.id);
 assert.equal(stage.state().current?.phase,'modifier');assert(!JSON.stringify(stage.state()).includes(mystery.modifier.instructions));assert(!JSON.stringify(a.state()).includes(mystery.modifier.title));
 const claimResults=await Promise.all([emit(a.s,'command',{action:'buzz'}),emit(b.s,'command',{action:'buzz'})]);assert.equal(claimResults.filter(r=>r.ok).length,1);
 await waitState(stage,v=>!!v.current?.revealed);await waitState(host,v=>v.modifierClaims.length===1);
 assert.equal(stage.state().currentQuestion?.modifier?.instructions,mystery.modifier.instructions);assert.equal(host.state().modifierClaims.length,1);
 assert.equal(host.state().players.find(p=>p.id===winner)?.score,100);
 const exported=await fetch(`${base}/api/games/${created.id}/export`);const definition=await exported.json();assert.equal(definition.rounds[0].categories[0].questions[1].modifier.instructions,mystery.modifier.instructions);assert(!('modifiers' in definition));assert(!('selection' in definition.settings));
 sockets.forEach(s=>s.disconnect());sockets=[];await server.close();restarted=await startServer({port:0,dataDir:dir,dev:false,quiet:true});const restored=restarted.games.get(created.id)!;assert.equal(restored.players.find(p=>p.id===winner)?.score,100);assert.equal(restored.id,created.id);assert(restored.players.every(p=>!p.connected));assert.equal(restored.modifierClaims.length,1);assert.equal(restored.modifierClaims[0].instructions,mystery.modifier.instructions);
 }finally{sockets.forEach(s=>s.disconnect());if(restarted)await restarted.close();else if(server.server.listening)await server.close();rmSync(dir,{recursive:true,force:true});}
});

test('older saved games load without automated rules or obsolete settings',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jeopardy-legacy-'));
 const game=createGame({definition:{rounds:demoRounds()}}),player=addPlayer(game,'Existing team');player.score=450;
 const stored=JSON.parse(JSON.stringify(game));delete stored.modifierClaims;
 stored.modifiers=[{name:'Old rule',trigger:'roundStart'}];stored.uses={old:{count:1}};
 stored.settings.answerOrder='random';stored.settings.showCategoryBeforeFinal=false;stored.settings.participantModifiers=true;
 stored.players[0].shield=1;stored.rounds[0].categories[0].questions[0].modifierIds=['old'];
 writeFileSync(join(dir,'games.json'),JSON.stringify([stored]));
 const server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});
 try{
  const restored=server.games.get(game.id)!;assert.equal(restored.id,game.id);assert.equal(restored.players[0].score,450);assert.equal(restored.players[0].token,player.token);assert.deepEqual(restored.modifierClaims,[]);
  const publicState=JSON.stringify(view(restored,'stage'));for(const key of ['Old rule','answerOrder','showCategoryBeforeFinal','participantModifiers','modifierIds','shield'])assert(!publicState.includes(key));
 }finally{await server.close();rmSync(dir,{recursive:true,force:true});}
});

test('imported games and existing owner-based saves can be hosted by anyone after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-open-host-'));mkdirSync(join(dir,'games'));
 writeFileSync(join(dir,'games','sample.json'),JSON.stringify({format:'jeopardy/1',name:'File sample',rounds:demoRounds()}));
 const legacy=createGame({name:'Old owner game',definition:{rounds:demoRounds()}});
 writeFileSync(join(dir,'games','legacy.json'),JSON.stringify({...legacy,hostToken:'retired-owner-key',hostClaimable:false}));
 let server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});const sockets:Socket[]=[];
 try{
  for(let round=0;round<2;round++){
   const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
   const listed=await (await fetch(base+'/api/games')).json();assert.equal(listed.length,2);
   for(const game of listed){
    const socket=io(base,{transports:['websocket'],autoConnect:false});sockets.push(socket);socket.connect();await once(socket,'connect');
    assert.equal((await emit(socket,'subscribe',{gameId:game.id,role:'host'})).ok,true);
    assert.equal((await fetch(`${base}/api/games/${game.id}/export`)).status,200);
    assert(!('hostToken' in server.games.get(game.id)!));assert(!('hostClaimable' in game));
   }
   sockets.forEach(socket=>socket.disconnect());await server.close();
   if(round===0)server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});
  }
 }finally{sockets.forEach(socket=>socket.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});

test('anyone can delete a game: removes the file, notifies every connected role, and survives pending saves and restarts', {timeout:10000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-delete-'));mkdirSync(join(dir,'games'));
 const file=join(dir,'games','named-board.json');writeFileSync(file,JSON.stringify({format:'jeopardy/1',name:'Delete fixture',rounds:demoRounds()}));
 let server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});const sockets:Socket[]=[];
 try{
  const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const game=[...server.games.values()][0];
  const keep=await (await fetch(base+'/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Keep fixture'})})).json();
  const player=await (await fetch(`${base}/api/games/${game.id}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Ada'})})).json();
  const remove=()=>fetch(`${base}/api/games/${game.id}`,{method:'DELETE'});
  assert(server.games.has(game.id));assert(existsSync(file));
  const connect=async(role:string,token?:string)=>{
   const socket=io(base,{autoConnect:false,transports:['websocket']});sockets.push(socket);socket.connect();await once(socket,'connect');
   assert.equal((await emit(socket,'subscribe',{gameId:game.id,role,token})).ok,true);return socket;
  };
  const host=await connect('host'),phone=await connect('player',player.token),stage=await connect('stage');
  const deleted=Promise.all([once(host,'deleted'),once(phone,'deleted'),once(stage,'deleted')]);
  const listUpdated=new Promise<void>(resolve=>stage.on('games',list=>{if(!list.some((entry:{id:string})=>entry.id===game.id))resolve();}));
  await emit(host,'command',{action:'adjust',data:{playerId:player.playerId,amount:100}});
  const response=await remove();assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
  assert((await deleted).every(message=>message==='This game was deleted by the host.'));await listUpdated;
  assert(!server.games.has(game.id));assert(server.games.has(keep.id));assert(!existsSync(file));
  assert.equal((await fetch(`${base}/api/games/${game.id}`)).status,404);
  assert.equal((await emit(host,'command',{action:'save',data:{name:'Cannot resurrect'}})).ok,false);
  assert.equal((await emit(phone,'command',{action:'ready',data:{ready:true}})).ok,false);
  assert.equal((await fetch(`${base}/api/games/${game.id}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:player.token})})).status,404);
  await new Promise(resolve=>setTimeout(resolve,200));assert(!existsSync(file));
  sockets.forEach(socket=>socket.disconnect());await server.close();server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});
  assert.equal(server.games.size,1);assert(server.games.has(keep.id));assert(!server.games.has(game.id));assert(!existsSync(file));
 }finally{sockets.forEach(socket=>socket.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});
test('a newly created game can be deleted before its first autosave',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-delete-unsaved-'));const server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});
 try{
  const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const created=await (await fetch(base+'/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Unsaved'})})).json();
  assert.equal((await fetch(`${base}/api/games/${created.id}`,{method:'DELETE'})).status,200);
  await server.close();assert(!existsSync(join(dir,'games',`${created.id}.json`)));assert.equal(server.games.size,0);
 }finally{await server.close();rmSync(dir,{recursive:true,force:true});}
});

test('reset returns host and stage to the lobby, revokes players, preserves the board and persists across restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-reset-'));let server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});const sockets:Socket[]=[];
 try{
  let base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const post=async(path:string,data:unknown)=>(await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).json();
  const created=await post('/api/games',{name:'Reset fixture',definition:{rounds:demoRounds(),settings:{allowLateJoin:false}}});
  const keep=await post('/api/games',{name:'Other game'});
  const pa=await post(`/api/games/${created.id}/join`,{name:'Ada'}),pb=await post(`/api/games/${created.id}/join`,{name:'Bea'});
  const connect=async(role:string,token?:string)=>{
   const s=io(base,{autoConnect:false,transports:['websocket']});sockets.push(s);let latest:GameView;s.on('state',v=>latest=v);s.connect();await once(s,'connect');
   const sub=await emit(s,'subscribe',{gameId:created.id,role,token});return{s,sub,state:()=>latest!};
  };
  const host=await connect('host'),a=await connect('player',pa.token),b=await connect('player',pb.token),stage=await connect('stage');
  for(const client of [a,stage])assert.equal((await emit(client.s,'command',{action:'reset'})).ok,false);
  await emit(host.s,'command',{action:'start'});
  const q=host.state().rounds[0].categories[0].questions[0];
  await emit(host.s,'command',{action:'openQuestion',data:{questionId:q.id}});
  await emit(host.s,'command',{action:'adjust',data:{playerId:pa.playerId,amount:800}});
  await emit(host.s,'command',{action:'closeQuestion'});await emit(host.s,'command',{action:'finish'});
  const exportBoard=async()=>(await fetch(`${base}/api/games/${created.id}/export`)).json();
  const definition=await exportBoard();
  const revoked=Promise.all([once(a.s,'revoked'),once(b.s,'revoked')]);
  const updatedList=new Promise<void>(resolve=>stage.s.on('games',list=>{const g=list.find((v:{id:string})=>v.id===created.id);if(g?.status==='lobby'&&g.playerCount===0)resolve();}));
  assert.equal((await emit(host.s,'command',{action:'reset'})).ok,true);
  assert((await revoked).every(message=>message==='The host reset this game. Join again to play.'));await updatedList;
  for(const client of [host,stage])await waitState(client,v=>v.status==='lobby'&&v.players.length===0&&v.current===null&&v.played.length===0);
  assert.deepEqual(await exportBoard(),definition);assert.equal(host.state().history.length,0);
  for(const client of [a,b])assert.equal((await emit(client.s,'command',{action:'ready',data:{ready:true}})).ok,false);
  assert.equal((await emit(a.s,'subscribe',{gameId:created.id,role:'player',token:pa.token})).ok,false);
  assert.equal((await emit(host.s,'command',{action:'undo'})).ok,false);
  const stored=server.games.get(created.id)!;assert.equal(stored.undo.length,0);assert.equal(stored.questionCount,0);assert.deepEqual(stored.modifierClaims,[]);
  sockets.forEach(s=>s.disconnect());await server.close();
  server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const restored=server.games.get(created.id)!;
  assert.equal(server.games.size,2);assert(server.games.has(keep.id));assert.equal(restored.id,created.id);assert.equal(restored.status,'lobby');assert.equal(restored.roundIndex,0);assert.equal(restored.players.length,0);assert.equal(restored.played.length,0);assert.equal(restored.current,null);assert.equal(restored.undo.length,0);
  assert.deepEqual(await exportBoard(),definition);
  assert.equal((await connect('host')).sub.ok,true);assert.equal((await connect('player',pa.token)).sub.ok,false);
  const fresh=await post(`/api/games/${created.id}/join`,{name:'Ada'});assert(fresh.token);assert.notEqual(fresh.token,pa.token);
  const phone=await connect('player',fresh.token);assert(phone.sub.ok);assert.equal(phone.state().players.find(p=>p.id===fresh.playerId)?.score,0);assert.equal(phone.state().players.find(p=>p.id===fresh.playerId)?.ready,false);
 }finally{sockets.forEach(s=>s.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});

test('library preparation saves before hosting; stale editors cannot change a running game and copies start fresh',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-prepare-'));const server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});const sockets:Socket[]=[];
 try{
  const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const post=async(path:string,data:unknown)=>(await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).json();
  const created=await post('/api/games',{name:'Prepared in advance'});
  const connect=async(editing=false,gameId=created.id)=>{
   const s=io(base,{autoConnect:false,transports:['websocket']});sockets.push(s);s.connect();await once(s,'connect');
   assert.equal((await emit(s,'subscribe',{gameId,role:'host',editing})).ok,true);return s;
  };
  const editor=await connect(true),host=await connect();
  const rounds=demoRounds();Object.assign(rounds[0].categories[0].questions[0],{answerOptions:['First choice','Correct choice','Third choice'],correctAnswerIndex:1});rounds[0].categories[0].questions[0].notes='Keep these notes';rounds[0].categories[0].questions[1].dailyDouble=true;
  rounds[1].categories[0].questions[0].modifier={title:'Prepared surprise',instructions:'Apply this manually.'};
  assert.equal((await emit(editor,'command',{action:'save',data:{rounds,settings:{revealDelayMs:0},theme:{title:'Prepared theme'}}})).ok,true);
  const before=await (await fetch(`${base}/api/games/${created.id}/export`)).json();
  assert.deepEqual(before.rounds[0].categories[0].questions[0].answerOptions,['First choice','Correct choice','Third choice']);assert.equal(before.rounds[0].categories[0].questions[0].answer,'Correct choice');assert.equal(before.rounds[0].categories[0].questions[0].correctAnswerIndex,1);
  const list=await (await fetch(base+'/api/games')).json();assert.equal(list.find((g:{id:string})=>g.id===created.id).questionTotal,41);
  const player=await post(`/api/games/${created.id}/join`,{name:'Ada'});
  assert.equal((await emit(editor,'subscribe',{gameId:created.id,role:'host',editing:false})).ok,true);
  await emit(host,'command',{action:'start'});await emit(host,'command',{action:'adjust',data:{playerId:player.playerId,amount:700}});
  const rejected=await emit(editor,'command',{action:'save',data:{rounds:[],name:'Must not change',settings:{startingScore:999},theme:{title:'Must not change'}}});
  assert.equal(rejected.ok,false);assert.match(rejected.error,/Make a copy to edit/);
  assert.equal((await fetch(`${base}/api/games/${created.id}/media`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
  const exported=await (await fetch(`${base}/api/games/${created.id}/export`)).json();assert.deepEqual(exported,before);
  const copied=await post('/api/games',{name:before.name+' (copy)',definition:{...before,name:before.name+' (copy)'}});
  assert.notEqual(copied.id,created.id);assert(!('hostToken' in copied));
  const copy=server.games.get(copied.id)!;assert.equal(copy.status,'lobby');assert.deepEqual(copy.players,[]);assert.deepEqual(copy.played,[]);assert.equal(copy.current,null);assert.deepEqual(copy.undo,[]);assert.deepEqual(copy.rounds,before.rounds);assert.deepEqual(copy.settings,before.settings);assert.deepEqual(copy.theme,before.theme);
  const copyEditor=await connect(true,copied.id);assert.equal((await emit(copyEditor,'command',{action:'save',data:{name:'Next event'}})).ok,true);
  assert.equal(server.games.get(created.id)!.players[0].score,700);assert.equal(server.games.get(created.id)!.name,before.name);assert.equal(copy.name,'Next event');
 }finally{sockets.forEach(s=>s.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});

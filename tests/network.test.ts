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
async function waitState(client:{s:Socket;state:()=>GameView},predicate:(v:GameView)=>boolean){
 if(predicate(client.state()))return;
 await new Promise<void>((resolve,reject)=>{
  const timeout=setTimeout(()=>{client.s.off('state',changed);reject(new Error('Expected synchronized state did not arrive'));},3000);
  const changed=(v:GameView)=>{if(predicate(v)){clearTimeout(timeout);client.s.off('state',changed);resolve();}};
  client.s.on('state',changed);
 });
}
test('real clients: discovery, auth, concurrent buzzes, synchronized scores, redaction, reconnect and persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jeopardy-test-'));const server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});let sockets:Socket[]=[];let restarted:Awaited<ReturnType<typeof startServer>>|null=null;
 try{const port=(server.server.address()as{port:number}).port;const base=`http://127.0.0.1:${port}`;const request=async(path:string,data?:unknown)=>{const r=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return r.json();};
 const rounds=demoRounds(),mystery=rounds[0].categories[0].questions[1];mystery.prompt='';mystery.modifier={title:'Trading places',instructions:'Swap your score with another team.'};
 const created=await request('/api/games',{name:'Network test',definition:{rounds}});const listed=await request('/api/games');assert.equal(listed[0].id,created.id);assert(!JSON.stringify(listed).includes(created.hostToken));
 const pa=await request(`/api/games/${created.id}/join`,{name:'Ada'}),pb=await request(`/api/games/${created.id}/join`,{name:'Bea'});const connect=async(role:string,token?:string)=>{const s=io(base,{transports:['websocket'],autoConnect:false});sockets.push(s);s.connect();await once(s,'connect');let state:GameView; s.on('state',v=>state=v);const sub=await emit(s,'subscribe',{gameId:created.id,role,token});return{s,sub,state:()=>state!};};
 const host=await connect('host',created.hostToken),a=await connect('player',pa.token),b=await connect('player',pb.token),stage=await connect('stage');assert(host.sub.ok&&a.sub.ok&&b.sub.ok&&stage.sub.ok);const fake=await connect('host','bad-key');assert.equal(fake.sub.ok,false);
 assert.equal((await emit(a.s,'command',{action:'adjust',data:{playerId:pa.playerId,amount:99999}})).ok,false);
 const q=host.state().rounds[0].categories[0].questions[0];assert.equal(stage.state().rounds[0].categories[0].questions[0].answer,'');
 await emit(host.s,'command',{action:'start'});await emit(host.s,'command',{action:'openQuestion',data:{questionId:q.id}});await emit(host.s,'command',{action:'openBuzzers'});const results=await Promise.all([emit(a.s,'command',{action:'buzz'}),emit(b.s,'command',{action:'buzz'})]);assert.equal(results.filter(r=>r.ok).length,1);
 const winner=host.state().current!.answeringId!;await emit(host.s,'command',{action:'judge',data:{correct:true}});assert.equal(host.state().players.find(p=>p.id===winner)?.score,100);assert.equal(stage.state().currentQuestion?.answer,'');assert.equal(a.state().currentQuestion?.answer,'');
 const again=await request(`/api/games/${created.id}/join`,{token:pa.token,name:'Ada'});assert.equal(again.playerId,pa.playerId);assert.equal((await request(`/api/games/${created.id}`)).players.length,2);
 const json=JSON.stringify(stage.state());assert(!json.includes(created.hostToken));assert(!json.includes(pa.token));
 await emit(host.s,'command',{action:'closeQuestion'});await emit(host.s,'command',{action:'save',data:{settings:{selection:'winner'}}});assert(!('selection' in host.state().settings));
 assert.equal((await emit(a.s,'command',{action:'selectQuestion',data:{questionId:mystery.id}})).ok,false);
 assert.equal((await emit(b.s,'command',{action:'selectQuestion',data:{questionId:mystery.id}})).ok,false);
 assert.equal((await emit(host.s,'command',{action:'openQuestion',data:{questionId:mystery.id}})).ok,true);
 await waitState(stage,v=>v.current?.questionId===mystery.id);await waitState(a,v=>v.current?.questionId===mystery.id);
 assert.equal(stage.state().current?.phase,'modifier');assert(!JSON.stringify(stage.state()).includes(mystery.modifier.instructions));assert(!JSON.stringify(a.state()).includes(mystery.modifier.title));
 await emit(host.s,'command',{action:'save',data:{settings:{revealDelayMs:0}}});
 const claimResults=await Promise.all([emit(a.s,'command',{action:'buzz'}),emit(b.s,'command',{action:'buzz'})]);assert.equal(claimResults.filter(r=>r.ok).length,1);
 await waitState(stage,v=>!!v.current?.revealed);await waitState(host,v=>v.modifierClaims.length===1);
 assert.equal(stage.state().currentQuestion?.modifier?.instructions,mystery.modifier.instructions);assert.equal(host.state().modifierClaims.length,1);
 assert.equal(host.state().players.find(p=>p.id===winner)?.score,100);
 const exported=await fetch(`${base}/api/games/${created.id}/export`,{headers:{Authorization:`Bearer ${created.hostToken}`}});const definition=await exported.json();assert.equal(definition.rounds[0].categories[0].questions[1].modifier.instructions,mystery.modifier.instructions);assert(!('modifiers' in definition));assert(!('selection' in definition.settings));
 sockets.forEach(s=>s.disconnect());sockets=[];await server.close();restarted=await startServer({port:0,dataDir:dir,dev:false,quiet:true});const restored=restarted.games.get(created.id)!;assert.equal(restored.players.find(p=>p.id===winner)?.score,100);assert.equal(restored.hostToken,created.hostToken);assert(restored.players.every(p=>!p.connected));assert.equal(restored.modifierClaims.length,1);assert.equal(restored.modifierClaims[0].instructions,mystery.modifier.instructions);
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
  const restored=server.games.get(game.id)!;assert.equal(restored.hostToken,game.hostToken);assert.equal(restored.players[0].score,450);assert.equal(restored.players[0].token,player.token);assert.deepEqual(restored.modifierClaims,[]);
  const publicState=JSON.stringify(view(restored,'stage'));for(const key of ['Old rule','answerOrder','showCategoryBeforeFinal','participantModifiers','modifierIds','shield'])assert(!publicState.includes(key));
 }finally{await server.close();rmSync(dir,{recursive:true,force:true});}
});

test('a directory-loaded definition can be hosted locally once without publishing its access key',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-file-host-'));mkdirSync(join(dir,'games'));
 const file=join(dir,'games','sample.json');writeFileSync(file,JSON.stringify({format:'jeopardy/1',name:'File sample',rounds:demoRounds()}));
 let server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});let socket:Socket|undefined;
 try{
  const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const listed=await (await fetch(base+'/api/games')).json(),game=listed[0];
  assert.equal(game.hostClaimable,true);assert(!JSON.stringify(listed).includes(server.games.get(game.id)!.hostToken));
  const claimed=await fetch(`${base}/api/games/${game.id}/claim-host`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(claimed.status,200);const {hostToken}=await claimed.json();
  assert.equal(hostToken,server.games.get(game.id)!.hostToken);assert.equal(JSON.parse(readFileSync(file,'utf8')).hostClaimable,false);
  assert.equal((await fetch(`${base}/api/games/${game.id}/claim-host`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const created=await (await fetch(base+'/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Browser game'})})).json();
  assert.equal((await fetch(`${base}/api/games/${created.id}/claim-host`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  socket=io(base,{transports:['websocket'],autoConnect:false});socket.connect();await once(socket,'connect');
  assert.equal((await emit(socket,'subscribe',{gameId:game.id,role:'host',token:hostToken})).ok,true);
  socket.disconnect();await server.close();server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});
  assert.equal(server.games.get(game.id)!.hostToken,hostToken);assert.equal(server.games.get(game.id)!.hostClaimable,false);
 }finally{socket?.disconnect();await server.close();rmSync(dir,{recursive:true,force:true});}
});

test('host deletion removes the file, notifies every connected role, and survives pending saves and restarts', {timeout:10000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-delete-'));mkdirSync(join(dir,'games'));
 const file=join(dir,'games','named-board.json');writeFileSync(file,JSON.stringify({format:'jeopardy/1',name:'Delete fixture',rounds:demoRounds()}));
 let server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});const sockets:Socket[]=[];
 try{
  const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const game=[...server.games.values()][0];
  const keep=await (await fetch(base+'/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Keep fixture'})})).json();
  const player=await (await fetch(`${base}/api/games/${game.id}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Ada'})})).json();
  const remove=(token?:string)=>fetch(`${base}/api/games/${game.id}`,{method:'DELETE',headers:token?{Authorization:`Bearer ${token}`}:{}});
  for(const token of [undefined,'wrong-token',player.token,keep.hostToken])assert.equal((await remove(token)).status,403);
  assert(server.games.has(game.id));assert(existsSync(file));
  const connect=async(role:string,token?:string)=>{
   const socket=io(base,{autoConnect:false,transports:['websocket']});sockets.push(socket);socket.connect();await once(socket,'connect');
   assert.equal((await emit(socket,'subscribe',{gameId:game.id,role,token})).ok,true);return socket;
  };
  const host=await connect('host',game.hostToken),phone=await connect('player',player.token),stage=await connect('stage');
  const deleted=Promise.all([once(host,'deleted'),once(phone,'deleted'),once(stage,'deleted')]);
  const listUpdated=new Promise<void>(resolve=>stage.on('games',list=>{if(!list.some((entry:{id:string})=>entry.id===game.id))resolve();}));
  await emit(host,'command',{action:'adjust',data:{playerId:player.playerId,amount:100}});
  const response=await remove(game.hostToken);assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
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
  assert.equal((await fetch(`${base}/api/games/${created.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${created.hostToken}`}})).status,200);
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
  const host=await connect('host',created.hostToken),a=await connect('player',pa.token),b=await connect('player',pb.token),stage=await connect('stage');
  for(const client of [a,stage])assert.equal((await emit(client.s,'command',{action:'reset'})).ok,false);
  await emit(host.s,'command',{action:'start'});
  const q=host.state().rounds[0].categories[0].questions[0];
  await emit(host.s,'command',{action:'openQuestion',data:{questionId:q.id}});
  await emit(host.s,'command',{action:'adjust',data:{playerId:pa.playerId,amount:800}});
  await emit(host.s,'command',{action:'closeQuestion'});await emit(host.s,'command',{action:'finish'});
  const exportBoard=async()=>(await fetch(`${base}/api/games/${created.id}/export`,{headers:{Authorization:`Bearer ${created.hostToken}`}})).json();
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
  assert.equal(server.games.size,2);assert(server.games.has(keep.id));assert.equal(restored.hostToken,created.hostToken);assert.equal(restored.status,'lobby');assert.equal(restored.roundIndex,0);assert.equal(restored.players.length,0);assert.equal(restored.played.length,0);assert.equal(restored.current,null);assert.equal(restored.undo.length,0);
  assert.deepEqual(await exportBoard(),definition);
  assert.equal((await connect('host',created.hostToken)).sub.ok,true);assert.equal((await connect('player',pa.token)).sub.ok,false);
  const fresh=await post(`/api/games/${created.id}/join`,{name:'Ada'});assert(fresh.token);assert.notEqual(fresh.token,pa.token);
  const phone=await connect('player',fresh.token);assert(phone.sub.ok);assert.equal(phone.state().players.find(p=>p.id===fresh.playerId)?.score,0);assert.equal(phone.state().players.find(p=>p.id===fresh.playerId)?.ready,false);
 }finally{sockets.forEach(s=>s.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});

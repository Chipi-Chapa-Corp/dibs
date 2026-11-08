import {markTeamsReady} from './helpers.ts';
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
// Existing gameplay fixtures provision their teams as the host before joining phones.
function fixtureRequest(server:Awaited<ReturnType<typeof startServer>>,base:string,path:string,data?:unknown){
  let payload=data as Record<string,unknown>|undefined;
  const match=path.match(/^\/api\/games\/([^/]+)\/join$/);
  if(match&&payload&&!payload.token&&!payload.teamId){
    const g=server.games.get(match[1])!;
    const name=String(payload.name||'').trim();
    const team=g.players.find(t=>t.name.toLowerCase()===name.toLowerCase())||addPlayer(g,name);
    payload={...payload,teamId:team.id};
  }
  return fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)});
}
test('Daily Double spoken choices are recorded by presenter and synchronized to read-only phones',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-daily-network-')),server=await startServer({port:0,dataDir:dir,dev:false,quiet:true}),sockets:Socket[]=[];
 try{
  const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const post=async(path:string,data:unknown)=>(await fixtureRequest(server,base,path,data)).json();
  const rounds=demoRounds();rounds[0].categories[0].questions[0].dailyDouble=true;
  const created=await post('/api/games',{name:'Daily Double network',definition:{rounds}}),a=await post(`/api/games/${created.id}/join`,{name:'Choosing team'}),b=await post(`/api/games/${created.id}/join`,{name:'Required team'});
  const connect=async(role:string,token?:string)=>{const s=io(base,{autoConnect:false,transports:['websocket']});sockets.push(s);let latest:GameView;s.on('state',v=>latest=v);s.connect();await once(s,'connect');assert((await emit(s,'subscribe',{gameId:created.id,role,token})).ok);return{s,state:()=>latest!};};
  const host=await connect('host'),selecting=await connect('player',a.token),answering=await connect('player',b.token),stage=await connect('stage');
  const command=(s:Socket,action:string,data?:unknown)=>emit(s,'command',{action,data});
  markTeamsReady(server.games.get(created.id)!);await command(host.s,'start');await command(host.s,'openQuestion',{questionId:rounds[0].categories[0].questions[0].id});
  assert.equal((await command(host.s,'setDailyDoubleChooser',{playerId:a.playerId})).ok,true);
  await waitState(selecting,v=>v.current?.dailyDoubleFromId===a.playerId&&!v.current?.answeringId);
  await waitState(stage,v=>v.current?.dailyDoubleFromId===a.playerId&&!v.current?.answeringId);
  assert.equal((await command(answering.s,'chooseDailyDoubleOpponent',{playerId:a.playerId})).ok,false);
  assert.equal((await command(selecting.s,'chooseDailyDoubleOpponent',{playerId:b.playerId})).ok,false);
  assert.equal((await command(host.s,'assignDailyDouble',{fromId:a.playerId,playerId:b.playerId})).ok,true);
  assert.equal((await command(selecting.s,'chooseDailyDoubleOpponent',{playerId:b.playerId})).ok,false);
  await waitState(answering,v=>v.current?.answeringId===b.playerId);assert.equal(answering.state().current?.dailyDoubleFromId,a.playerId);
  assert.equal((await command(selecting.s,'wager',{wager:750})).ok,false);
  assert.equal((await command(answering.s,'wager',{wager:750})).ok,false);
  assert.equal((await command(host.s,'hostWager',{playerId:b.playerId,wager:750})).ok,true);
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
test('a buzzer race broadcasts the winner once; rejected early-buzz penalties still synchronize',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-buzz-traffic-'));
 const server=await startServer({port:0,dataDir:dir,dev:false,quiet:true}),sockets:Socket[]=[];
 try{
  const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const post=async(path:string,data:unknown)=>(await fixtureRequest(server,base,path,data)).json();
  const created=await post('/api/games',{definition:{rounds:demoRounds()}});
  const members:{token:string;playerId:string}[]=[];
  for(let i=0;i<6;i++)members.push(await post(`/api/games/${created.id}/join`,{name:`Team ${i}`}));
  const connect=async(role:string,token?:string)=>{
   const s=io(base,{autoConnect:false,transports:['websocket']});sockets.push(s);
   let latest:GameView;s.on('state',state=>latest=state);s.connect();await once(s,'connect');
   assert((await emit(s,'subscribe',{gameId:created.id,role,token})).ok);
   return{s,state:()=>latest!};
  };
  const host=await connect('host'),phones=[];
  for(const member of members)phones.push(await connect('player',member.token));
  const command=(s:Socket,action:string,data?:unknown)=>emit(s,'command',{action,data});
  markTeamsReady(server.games.get(created.id)!);await command(host.s,'start');
  assert((await command(host.s,'openQuestion',{questionId:server.games.get(created.id)!.rounds[0].categories[0].questions[0].id})).ok);
  await Promise.all(phones.map(phone=>waitState(phone,state=>!!state.current?.buzzOpen)));
  const updates=new Map(sockets.map(s=>[s.id!,0]));
  for(const s of sockets)s.on('state',()=>updates.set(s.id!,updates.get(s.id!)!+1));
  const results=await Promise.all(phones.map(phone=>command(phone.s,'buzz')));
  assert.equal(results.filter(result=>result.ok).length,1);
  await Promise.all([host,...phones].map(phone=>waitState(phone,state=>!!state.current?.answeringId)));
  for(const count of updates.values())assert.equal(count,1,'losing buzzes must not rebroadcast unchanged state');
  const winner=host.state().current?.answeringId;
  assert(phones.every(phone=>phone.state().current?.answeringId===winner));

  await command(host.s,'resetBuzzers');await command(host.s,'closeBuzzers');
  await Promise.all(phones.map(phone=>waitState(phone,state=>state.current?.buzzOpen===false&&!state.current.answeringId)));
  const early=phones[0];
  assert.equal((await command(early.s,'buzz')).ok,false);
  await waitState(host,state=>state.players.find(p=>p.id===members[0].playerId)!.blockedUntil>0);
  await waitState(early,state=>state.players.find(p=>p.id===members[0].playerId)!.blockedUntil>0);
 }finally{sockets.forEach(s=>s.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});
for(const buzzMode of ['queue','first']as const)test(`group phones share one score and wrong-answer lockout in ${buzzMode} mode, including after restart`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-groups-'));let server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});const sockets:Socket[]=[];
 try{
  let base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const post=async(path:string,data:unknown)=>{
   const response=await fixtureRequest(server,base,path,data);
   assert.equal(response.status,200);return response.json();
  };
  const created=await (await fetch(base+'/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({definition:{rounds:demoRounds(),settings:{buzzMode,earlyPenaltyMs:0}}})})).json();
  const joinPath=`/api/games/${created.id}/join`;
  const team=await post(joinPath,{name:'Team Ada'}),teammate=await post(joinPath,{name:'Ada teammate',teamId:team.playerId}),opponent=await post(joinPath,{name:'Team Bea'});
  assert.equal(teammate.playerId,team.playerId);assert.notEqual(teammate.token,team.token);assert.notEqual(teammate.memberId,team.memberId);
  const connect=async(role:string,token?:string)=>{
   const s=io(base,{autoConnect:false,transports:['websocket']});sockets.push(s);let latest:GameView;
   s.on('state',v=>latest=v);s.connect();await once(s,'connect');
   assert.equal((await emit(s,'subscribe',{gameId:created.id,role,token})).ok,true);return{s,state:()=>latest!};
  };
  const host=await connect('host'),stage=await connect('stage'),a=await connect('player',team.token),b=await connect('player',teammate.token),other=await connect('player',opponent.token);
  const command=(s:Socket,action:string,data?:unknown)=>emit(s,'command',{action,data});
  assert.equal(a.state().selfId,b.state().selfId);assert.equal(host.state().players.length,2);
  const summaries=await (await fetch(base+'/api/games')).json();assert.equal(summaries[0].playerCount,2);
  await command(a.s,'ready',{ready:true});await waitState(b,v=>v.players.find(p=>p.id===team.playerId)?.ready===true);
  markTeamsReady(server.games.get(created.id)!);await command(host.s,'start');const question=host.state().rounds[0].categories[0].questions[0];
  await command(host.s,'openQuestion',{questionId:question.id});await command(host.s,'openBuzzers');
  const buzzes=await Promise.all([command(a.s,'buzz'),command(b.s,'buzz')]);assert.equal(buzzes.filter(r=>r.ok).length,1);
  await waitState(host,v=>v.current?.answeringId===team.playerId);
  assert.equal(host.state().current?.buzzes.length,1);assert.equal(host.state().players.find(p=>p.id===team.playerId)?.stats.buzzes,1);
  await command(host.s,'judge',{correct:false});
  for(const phone of [a,b]){
   await waitState(phone,v=>v.players.find(p=>p.id===team.playerId)?.score===-100);
   assert(phone.state().current?.attempted.includes(team.playerId));assert.equal((await command(phone.s,'buzz')).ok,false);
  }
  // Another phone joining after a miss cannot bypass the group's lockout.
  const late=await post(joinPath,{name:'Late teammate',teamId:team.playerId}),c=await connect('player',late.token);
  assert.equal(late.playerId,team.playerId);assert.equal((await command(c.s,'buzz')).ok,false);
  assert.equal((await command(other.s,'buzz')).ok,true);assert.equal((await command(host.s,'judge',{correct:true})).ok,true);
  await waitState(stage,v=>v.players.find(p=>p.id===opponent.playerId)?.score===100);
  assert.equal(stage.state().players.length,2);assert.equal(stage.state().players.find(p=>p.id===team.playerId)?.stats.incorrect,1);
  for(const client of [host,stage,a,b,c])assert(!JSON.stringify(client.state()).includes(team.token));
  a.s.disconnect();b.s.disconnect();
  await command(c.s,'ready',{ready:false});assert(server.games.get(created.id)!.players.find(p=>p.id===team.playerId)?.connected);
  c.s.disconnect();await waitState(host,v=>v.players.find(p=>p.id===team.playerId)?.connected===false);
  // A new question restores eligibility for every phone in the group.
  await command(host.s,'closeQuestion');await command(host.s,'openQuestion',{questionId:host.state().rounds[0].categories[0].questions[1].id});await command(host.s,'openBuzzers');
  const reconnected=await connect('player',team.token);assert.equal((await command(reconnected.s,'buzz')).ok,true);
  await command(host.s,'judge',{correct:true});await waitState(reconnected,v=>v.players.find(p=>p.id===team.playerId)?.score===100);
  sockets.forEach(s=>s.disconnect());await server.close();
  server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const restored=await post(joinPath,{token:team.token});assert.equal(restored.playerId,team.playerId);assert.equal(restored.token,team.token);
  const restoredA=await connect('player',team.token),restoredB=await connect('player',teammate.token);
  for(const phone of [restoredA,restoredB]){assert.equal(phone.state().players.length,2);assert.equal(phone.state().players.find(p=>p.id===team.playerId)?.score,100);}
 }finally{sockets.forEach(s=>s.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});
test('legacy room PINs and player limits are ignored when loading and importing games',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jeopardy-open-join-'));mkdirSync(join(dir,'games'));
 const game=createGame({name:'Legacy room'});
 Object.assign(game.settings,{joinPin:'2468',maxPlayers:1});
 writeFileSync(join(dir,'games',`${game.id}.json`),JSON.stringify(game));
 const server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});
 try{
  const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const post=(path:string,data:unknown)=>fixtureRequest(server,base,path,data);
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
  addPlayer(server.games.get(created.id)!,'Test team');
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
  assert.equal((await emit(second.s,'subscribe',{gameId:created.id,role:'stage'})).ok,true);
  await waitState(host,v=>v.editLock===null);
  markTeamsReady(server.games.get(created.id)!);assert.equal((await emit(host.s,'command',{action:'start'})).ok,true);
  assert.equal((await emit(second.s,'command',{action:'pause'})).ok,false);
  assert.equal((await emit(host.s,'command',{action:'pause'})).ok,true);
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
test('hosting locks admit one host, release on navigation or disconnect, and reset after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-host-lock-'));let server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});const sockets:Socket[]=[];
 try{
  let base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const create=async(name:string)=>(await (await fetch(base+'/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,definition:{rounds:demoRounds()}})})).json()).id;
  const a=await create('Game A'),b=await create('Game B');
  const listed=async()=>(await fetch(base+'/api/games')).json();
  const connect=async()=>{const s=io(base,{autoConnect:false,transports:['websocket']});sockets.push(s);s.connect();await once(s,'connect');return s;};
  const first=await connect(),second=await connect();
  const attempts=await Promise.all([first,second].map(s=>emit(s,'subscribe',{gameId:a,role:'host'})));
  assert.equal(attempts.filter(result=>result.ok).length,1);
  const host=attempts[0].ok?first:second,other=host===first?second:first;
  assert.match(attempts.find(result=>!result.ok).error,/already hosting/);
  assert.equal((await listed()).find((g:{id:string})=>g.id===a).hosting,true);
  assert.equal((await emit(other,'command',{action:'start'})).ok,false);
  assert.equal((await emit(host,'subscribe',{gameId:a,role:'host'})).ok,true);
  // Editing and hosting have independent locks; editors cannot send gameplay commands.
  assert.equal((await emit(other,'subscribe',{gameId:a,role:'host',editing:true})).ok,true);
  assert.equal((await emit(other,'command',{action:'reset'})).ok,false);
  assert.equal((await emit(other,'command',{action:'save',data:{name:'Edited while hosted'}})).ok,true);
  assert.equal((await emit(other,'subscribe',{gameId:a,role:'stage'})).ok,true);
  assert.equal((await listed()).find((g:{id:string})=>g.id===a).hosting,true);
  // Moving to another game frees the old game immediately.
  assert.equal((await emit(host,'subscribe',{gameId:b,role:'host'})).ok,true);
  const moved=await listed();assert.equal(moved.find((g:{id:string})=>g.id===a).hosting,false);assert.equal(moved.find((g:{id:string})=>g.id===b).hosting,true);
  assert.equal((await emit(other,'subscribe',{gameId:a,role:'host'})).ok,true);
  // Moving from the host screen to the editor also frees hosting.
  assert.equal((await emit(other,'subscribe',{gameId:a,role:'host',editing:true})).ok,true);
  assert.equal((await listed()).find((g:{id:string})=>g.id===a).hosting,false);
  assert.equal((await emit(other,'subscribe',{gameId:a,role:'host'})).ok,true);
  const released=new Promise<void>(resolve=>host.on('games',list=>{if(list.some((g:{id:string;hosting:boolean})=>g.id===a&&!g.hosting))resolve();}));
  other.disconnect();await released;
  assert.equal((await emit(host,'subscribe',{gameId:a,role:'host'})).ok,true);
  await server.close();server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  assert((await listed()).every((g:{hosting:boolean})=>!g.hosting));
  const newHost=await connect();assert.equal((await emit(newHost,'subscribe',{gameId:a,role:'host'})).ok,true);
 }finally{sockets.forEach(s=>s.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});
test('real clients: discovery, open hosting, concurrent buzzes, synchronized scores, redaction, reconnect and persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jeopardy-test-'));const server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});let sockets:Socket[]=[];let restarted:Awaited<ReturnType<typeof startServer>>|null=null;
 try{const port=(server.server.address()as{port:number}).port;const base=`http://127.0.0.1:${port}`;const request=async(path:string,data?:unknown)=>{const r=await fixtureRequest(server,base,path,data);return r.json();};
 const rounds=demoRounds(),mystery=rounds[0].categories[0].questions[1];mystery.prompt='';mystery.modifier={title:'Trading places',instructions:'Swap your score with another team.'};
 const created=await request('/api/games',{name:'Network test',definition:{rounds,settings:{buzzMode:'first'}}});const listed=await request('/api/games');assert.equal(listed[0].id,created.id);assert(!('hostToken' in created));
 const pa=await request(`/api/games/${created.id}/join`,{name:'Ada'}),pb=await request(`/api/games/${created.id}/join`,{name:'Bea'});const connect=async(role:string,token?:string)=>{const s=io(base,{transports:['websocket'],autoConnect:false});sockets.push(s);s.connect();await once(s,'connect');let state:GameView; s.on('state',v=>state=v);const sub=await emit(s,'subscribe',{gameId:created.id,role,token});return{s,sub,state:()=>state!};};
 const host=await connect('host'),a=await connect('player',pa.token),b=await connect('player',pb.token),stage=await connect('stage');assert(host.sub.ok&&a.sub.ok&&b.sub.ok&&stage.sub.ok);const anotherHost=await connect('host');assert.equal(anotherHost.sub.ok,false);assert.equal((await emit(anotherHost.s,'command',{action:'start'})).ok,false);
 assert.equal((await emit(a.s,'command',{action:'adjust',data:{playerId:pa.playerId,amount:99999}})).ok,false);
 const q=host.state().rounds[0].categories[0].questions[0];assert.equal(stage.state().rounds[0].categories[0].questions[0].answer,'');
 markTeamsReady(server.games.get(created.id)!);await emit(host.s,'command',{action:'start'});await emit(host.s,'command',{action:'selectQuestion',data:{questionId:q.id}});
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
  const player=await (await fixtureRequest(server,base,`/api/games/${game.id}/join`,{name:'Ada'})).json();
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
  const post=async(path:string,data:unknown)=>(await fixtureRequest(server,base,path,data)).json();
  const created=await post('/api/games',{name:'Reset fixture',definition:{rounds:demoRounds(),settings:{allowLateJoin:false}}});
  const keep=await post('/api/games',{name:'Other game'});
  const pa=await post(`/api/games/${created.id}/join`,{name:'Ada'}),pb=await post(`/api/games/${created.id}/join`,{name:'Bea'});
  const connect=async(role:string,token?:string)=>{
   const s=io(base,{autoConnect:false,transports:['websocket']});sockets.push(s);let latest:GameView;s.on('state',v=>latest=v);s.connect();await once(s,'connect');
   const sub=await emit(s,'subscribe',{gameId:created.id,role,token});return{s,sub,state:()=>latest!};
  };
  const host=await connect('host'),a=await connect('player',pa.token),b=await connect('player',pb.token),stage=await connect('stage');
  for(const client of [a,stage])assert.equal((await emit(client.s,'command',{action:'reset'})).ok,false);
  markTeamsReady(server.games.get(created.id)!);await emit(host.s,'command',{action:'start'});
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
  const post=async(path:string,data:unknown)=>(await fixtureRequest(server,base,path,data)).json();
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
  assert.equal((await emit(editor,'subscribe',{gameId:created.id,role:'host',editing:false})).ok,false);
  assert.equal((await emit(editor,'subscribe',{gameId:created.id,role:'stage'})).ok,true);
  markTeamsReady(server.games.get(created.id)!);await emit(host,'command',{action:'start'});await emit(host,'command',{action:'adjust',data:{playerId:player.playerId,amount:700}});
  assert.equal((await emit(editor,'subscribe',{gameId:created.id,role:'host',editing:true})).ok,true);
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

test('private final synchronizes teammates, rejects stale writes, reconnects and keeps other sockets and HTTP views spoiler-free',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-private-final-network-')),server=await startServer({port:0,dataDir:dir,dev:false,quiet:true}),sockets:Socket[]=[];
 try{
  const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const post=async(path:string,data:unknown)=>(await fixtureRequest(server,base,path,data)).json();
  const created=await post('/api/games',{name:'Private final',definition:{rounds:demoRounds()}}),game=server.games.get(created.id)!;
  const red=addPlayer(game,'Red'),blue=addPlayer(game,'Blue');red.score=1000;blue.score=800;
  const alice=await post(`/api/games/${created.id}/join`,{name:'Alice',teamId:red.id}),alex=await post(`/api/games/${created.id}/join`,{name:'Alex',teamId:red.id}),bob=await post(`/api/games/${created.id}/join`,{name:'Bob',teamId:blue.id});
  const connect=async(role:string,token?:string)=>{const s=io(base,{autoConnect:false,transports:['websocket']});sockets.push(s);let latest:GameView;s.on('state',v=>latest=v);s.connect();await once(s,'connect');assert((await emit(s,'subscribe',{gameId:created.id,role,token})).ok);return{s,state:()=>latest!};};
  const host=await connect('host'),first=await connect('player',alice.token),second=await connect('player',alex.token),other=await connect('player',bob.token),stage=await connect('stage');
  const cmd=(s:Socket,action:string,data?:unknown)=>emit(s,'command',{action,data});
  markTeamsReady(game);assert((await cmd(host.s,'start')).ok);assert((await cmd(host.s,'round',{index:2})).ok);
  const questionId=game.current!.questionId;
  assert((await cmd(first.s,'wager',{questionId,version:0,wager:731,playerId:blue.id})).ok);
  await waitState(second,v=>v.yourFinal?.wager===731);assert.equal(second.state().yourFinal?.wagerVersion,1);
  assert.equal((await cmd(second.s,'wager',{questionId,version:0,wager:100})).ok,false);
  assert((await cmd(other.s,'wager',{questionId,version:0,wager:319})).ok);
  await waitState(stage,v=>Object.keys(v.current!.wagers).length===2);assert.equal(stage.state().current?.wagers[red.id].wager,0);
  assert((await cmd(host.s,'finalBegin')).ok);
  assert((await cmd(first.s,'finalAnswer',{questionId,version:0,answer:'RED PRIVATE FINAL'})).ok);
  await waitState(second,v=>v.yourFinal?.answer==='RED PRIVATE FINAL');
  first.s.disconnect();const rejoined=await post(`/api/games/${created.id}/join`,{token:alice.token});assert.equal(rejoined.memberId,alice.memberId);
  const reconnect=await connect('player',alice.token);assert.equal(reconnect.state().yourFinal?.answer,'RED PRIVATE FINAL');
  assert((await cmd(second.s,'finalAnswer',{questionId,version:1,answer:'RED REVISED FINAL'})).ok);
  await waitState(reconnect,v=>v.yourFinal?.answer==='RED REVISED FINAL');
  assert((await cmd(other.s,'finalAnswer',{questionId,version:0,answer:'BLUE PRIVATE FINAL'})).ok);
  assert((await cmd(host.s,'lockFinalAnswers',{questionId})).ok);
  assert.equal((await cmd(second.s,'finalAnswer',{questionId,version:2,answer:'Late'})).ok,false);
  assert((await cmd(host.s,'gradeTeam',{questionId,playerId:red.id,result:'correct'})).ok);
  assert((await cmd(host.s,'gradeTeam',{questionId,playerId:blue.id,result:'incorrect'})).ok);
  await waitState(host,v=>v.players[0].score===1731&&v.players[1].score===481);
  for(const client of [stage,other]){
    const snapshot=client.state();assert.equal(snapshot.current?.wagers[red.id].wager,0);assert(!JSON.stringify(snapshot).includes('RED REVISED FINAL'));assert.deepEqual(snapshot.players.map(p=>p.score),[1000,800]);assert.deepEqual(snapshot.history,[]);
  }
  const http=await(await fetch(`${base}/api/games/${game.id}`)).json();assert.equal(http.current.wagers[red.id].wager,0);assert(!JSON.stringify(http).includes('RED REVISED FINAL'));assert.deepEqual(http.finalPresentation.wagers,{});
  assert.equal(reconnect.state().yourFinal?.judged,false);assert.equal(reconnect.state().yourFinal?.correct,undefined);
  assert((await cmd(host.s,'continueQuestion',{questionId})).ok);
  await waitState(stage,v=>v.status==='finished');assert.equal(stage.state().current?.wagers[red.id].answer,'RED REVISED FINAL');assert.equal(stage.state().current?.wagers[red.id].wager,731);
 }finally{sockets.forEach(s=>s.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {io,Socket} from 'socket.io-client';
import {startServer} from '../server/index.ts';
import {demoRounds,newEffect,newModifier} from '../shared/model.ts';
import type {GameView} from '../shared/model.ts';
const once=(s:Socket,event:string)=>new Promise<any>(resolve=>s.once(event,resolve));
const emit=(s:Socket,event:string,data:unknown)=>new Promise<any>((resolve,reject)=>s.timeout(3000).emit(event,data,(err:Error,result:unknown)=>err?reject(err):resolve(result)));
test('real clients: discovery, auth, concurrent buzzes, synchronized scores, redaction, reconnect and persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jeopardy-test-'));const server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});let sockets:Socket[]=[];let restarted:Awaited<ReturnType<typeof startServer>>|null=null;
 try{const port=(server.server.address()as{port:number}).port;const base=`http://127.0.0.1:${port}`;const request=async(path:string,data?:unknown)=>{const r=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return r.json();};
 const created=await request('/api/games',{name:'Network test',definition:{rounds:demoRounds()}});const listed=await request('/api/games');assert.equal(listed[0].id,created.id);assert(!JSON.stringify(listed).includes(created.hostToken));
 const simulated=await fetch(`${base}/api/games/${created.id}/simulate`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${created.hostToken}`},body:JSON.stringify({modifier:newModifier({effects:[newEffect({type:'add',amount:100})]}),actorScore:20,targetScore:50})});assert.equal(simulated.status,200);assert.equal((await simulated.json()).actor.score,120);
 const pa=await request(`/api/games/${created.id}/join`,{name:'Ada'}),pb=await request(`/api/games/${created.id}/join`,{name:'Bea'});const connect=async(role:string,token?:string)=>{const s=io(base,{transports:['websocket'],autoConnect:false});sockets.push(s);s.connect();await once(s,'connect');let state:GameView; s.on('state',v=>state=v);const sub=await emit(s,'subscribe',{gameId:created.id,role,token});return{s,sub,state:()=>state!};};
 const host=await connect('host',created.hostToken),a=await connect('player',pa.token),b=await connect('player',pb.token),stage=await connect('stage');assert(host.sub.ok&&a.sub.ok&&b.sub.ok&&stage.sub.ok);const fake=await connect('host','bad-key');assert.equal(fake.sub.ok,false);
 assert.equal((await emit(a.s,'command',{action:'adjust',data:{playerId:pa.playerId,amount:99999}})).ok,false);
 const q=host.state().rounds[0].categories[0].questions[0];assert.equal(stage.state().rounds[0].categories[0].questions[0].answer,'');
 await emit(host.s,'command',{action:'start'});await emit(host.s,'command',{action:'openQuestion',data:{questionId:q.id}});await emit(host.s,'command',{action:'openBuzzers'});const results=await Promise.all([emit(a.s,'command',{action:'buzz'}),emit(b.s,'command',{action:'buzz'})]);assert.equal(results.filter(r=>r.ok).length,1);
 const winner=host.state().current!.answeringId!;await emit(host.s,'command',{action:'judge',data:{correct:true}});assert.equal(host.state().players.find(p=>p.id===winner)?.score,100);assert.equal(stage.state().currentQuestion?.answer,'');assert.equal(a.state().currentQuestion?.answer,'');
 const again=await request(`/api/games/${created.id}/join`,{token:pa.token,name:'Ada'});assert.equal(again.playerId,pa.playerId);assert.equal((await request(`/api/games/${created.id}`)).players.length,2);
 const json=JSON.stringify(stage.state());assert(!json.includes(created.hostToken));assert(!json.includes(pa.token));
 sockets.forEach(s=>s.disconnect());sockets=[];await server.close();restarted=await startServer({port:0,dataDir:dir,dev:false,quiet:true});const restored=restarted.games.get(created.id)!;assert.equal(restored.players.find(p=>p.id===winner)?.score,100);assert.equal(restored.hostToken,created.hostToken);assert(restored.players.every(p=>!p.connected));
 }finally{sockets.forEach(s=>s.disconnect());if(restarted)await restarted.close();else if(server.server.listening)await server.close();rmSync(dir,{recursive:true,force:true});}
});

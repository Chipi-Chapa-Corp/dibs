import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {io,Socket} from 'socket.io-client';
import {startServer} from '../server/index.ts';
import {token,view} from '../server/engine.ts';
import {demoRounds} from '../shared/model.ts';

const emit=(s:Socket,event:string,data:unknown)=>new Promise<any>((resolve,reject)=>s.timeout(3000).emit(event,data,(err:Error,result:unknown)=>err?reject(err):resolve(result)));
async function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'dibs-host-transfer-'));
  let server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});
  const sockets:Socket[]=[];
  const request=async(path:string,method='GET',data?:unknown,key?:string)=>{
    const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    return{status:response.status,body:await response.json()};
  };
  const created=(await request('/api/games','POST',{name:'Transfer fixture',definition:{rounds:demoRounds()}})).body;
  const connect=async(role:string,key?:string)=>{
    const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
    const s=io(base,{transports:['websocket'],autoConnect:false});sockets.push(s);
    const ready=new Promise<void>(resolve=>s.once('connect',()=>resolve()));s.connect();await ready;
    return{s,result:await emit(s,'subscribe',{gameId:created.id,role,token:key})};
  };
  return{dir,created,request,connect,game:()=>server.games.get(created.id)!,
    restart:async()=>{sockets.forEach(s=>s.disconnect());await server.close();server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});},
    close:async()=>{sockets.forEach(s=>s.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}};
}

test('host handoff persists, revokes every old host, preserves play and retries a lost response safely',async()=>{
  const f=await fixture();
  try{
    const{id,hostToken:oldKey}=f.created,path=`/api/games/${id}/host-transfer`;
    const player=(await f.request(`/api/games/${id}/join`,'POST',{name:'Ada'})).body;
    const old=await f.connect('host',oldKey),otherOld=await f.connect('host',oldKey),phone=await f.connect('player',player.token),stage=await f.connect('stage');
    assert(old.result.ok&&otherOld.result.ok&&phone.result.ok&&stage.result.ok);
    const command=(s:Socket,action:string,data?:unknown)=>emit(s,'command',{action,data});
    await command(old.s,'start');await command(old.s,'openQuestion',{questionId:f.game().rounds[0].categories[0].questions[0].id});
    await command(old.s,'adjust',{playerId:player.playerId,amount:300,mode:'set'});
    // Older saves contained credentials in undo snapshots. Undo must ignore them.
    Object.assign(f.game().undo.at(-1)as object,{hostToken:oldKey,hostClaimable:true,hostTransfer:{tokenHash:'0'.repeat(64),expiresAt:Date.now()+10000}});
    const current=structuredClone(f.game().current),rounds=structuredClone(f.game().rounds);
    const link=(await f.request(path,'POST',{},oldKey)).body;
    assert.equal(link.transferToken.length,48);assert(link.expiresAt>Date.now());
    assert.notEqual(f.game().hostTransfer?.tokenHash,link.transferToken);
    for(const role of ['host','stage','player']as const){
      const publicState=JSON.stringify(view(f.game(),role,player.playerId));
      assert(!publicState.includes('hostTransfer'));assert(!publicState.includes(link.transferToken));assert(!publicState.includes(f.game().hostTransfer!.tokenHash));
    }
    const exported=(await f.request(`/api/games/${id}/export`,'GET',undefined,oldKey)).body;
    assert(!('hostTransfer'in exported));
    // A pending link survives a server restart, without keeping the raw secret.
    await f.restart();assert(f.game().hostTransfer);assert.equal(f.game().hostToken,oldKey);
    const oldAgain=await f.connect('host',oldKey),otherAgain=await f.connect('host',oldKey);
    const revoked=Promise.all([oldAgain.s,otherAgain.s].map(s=>new Promise<string>(resolve=>s.once('host-revoked',resolve))));
    const newKey=token(),accept={transferToken:link.transferToken,hostToken:newKey};
    assert.equal((await f.request(path+'/accept','POST',accept)).status,200);
    assert((await revoked).every(message=>message.includes('transferred')));
    const saved=JSON.parse(readFileSync(join(f.dir,'games',`${id}.json`),'utf8'));
    assert.equal(saved.hostToken,newKey);assert.equal(saved.hostTransfer,null);
    assert.equal(f.game().players[0].token,player.token);assert.equal(f.game().players[0].score,300);
    assert.deepEqual(f.game().current,current);assert.deepEqual(f.game().rounds,rounds);
    assert.equal((await command(oldAgain.s,'finish')).ok,false);
    assert.equal((await command(otherAgain.s,'reset')).ok,false);
    assert.equal((await f.connect('host',oldKey)).result.ok,false);
    assert.equal((await f.request(`/api/games/${id}/export`,'GET',undefined,oldKey)).status,403);
    assert.equal((await f.request(path,'POST',{},oldKey)).status,403);
    assert.equal((await f.request(`/api/games/${id}`,'DELETE',undefined,oldKey)).status,403);
    // Same saved receiver key can retry after a lost response; other receivers cannot replay.
    assert.equal((await f.request(path+'/accept','POST',accept)).status,200);
    assert.equal((await f.request(path+'/accept','POST',{...accept,hostToken:token()})).status,400);
    const next=await f.connect('host',newKey);assert(next.result.ok);
    assert.equal((await command(next.s,'undo')).ok,true);
    assert.equal(f.game().hostToken,newKey);assert.equal(f.game().hostTransfer,null);assert.equal(f.game().hostClaimable,false);
    assert.equal(f.game().players[0].score,0);assert.deepEqual(f.game().current,current);
    await f.restart();assert.equal(f.game().hostToken,newKey);
    assert.equal((await f.request(path+'/accept','POST',accept)).status,200);
    assert.equal((await f.connect('host',newKey)).result.ok,true);
    assert.equal((await f.connect('player',player.token)).result.ok,true);
  }finally{await f.close();}
});

test('transfer links require host access, expire, cancel, replace and have a single concurrent winner',async()=>{
  const f=await fixture();
  try{
    const{id,hostToken}=f.created,path=`/api/games/${id}/host-transfer`;
    const player=(await f.request(`/api/games/${id}/join`,'POST',{name:'Ada'})).body;
    for(const key of [undefined,'wrong',player.token])for(const method of ['GET','POST','DELETE'])assert.equal((await f.request(path,method,method==='POST'?{}:undefined,key)).status,403);
    const link=async()=>(await f.request(path,'POST',{},hostToken)).body;
    const accept=(transferToken:unknown,key=token())=>f.request(path+'/accept','POST',{transferToken,hostToken:key});
    const first=await link(),replacement=await link();
    assert.equal((await accept(first.transferToken)).status,400);
    assert.equal((await accept('bad')).status,400);
    assert.equal((await accept(replacement.transferToken,replacement.transferToken)).status,400);
    assert.equal((await f.request(path,'DELETE',undefined,hostToken)).status,200);
    assert.equal((await accept(replacement.transferToken)).status,400);
    const expired=await link();f.game().hostTransfer!.expiresAt=Date.now()-1;
    assert.equal((await accept(expired.transferToken)).status,400);assert.equal(f.game().hostToken,hostToken);
    const final=await link(),keys=[token(),token()];
    const results=await Promise.all(keys.map(key=>accept(final.transferToken,key)));
    assert.deepEqual(results.map(v=>v.status).sort(),[200,400]);
    assert.equal(f.game().hostToken,keys[results.findIndex(v=>v.status===200)]);
  }finally{await f.close();}
});

test('a failed durable save cannot revoke the host or consume a pending handoff',async()=>{
  const f=await fixture();
  try{
    const{id,hostToken}=f.created,path=`/api/games/${id}/host-transfer`;
    const old=await f.connect('host',hostToken);const link=(await f.request(path,'POST',{},hostToken)).body;
    const before=structuredClone(f.game().hostTransfer),blocked=join(f.dir,'games',`${id}.json.tmp`);
    mkdirSync(blocked);
    const newKey=token();
    assert.equal((await f.request(path+'/accept','POST',{transferToken:link.transferToken,hostToken:newKey})).status,400);
    assert.equal(f.game().hostToken,hostToken);assert.deepEqual(f.game().hostTransfer,before);
    assert.equal((await f.request(path,'POST',{},hostToken)).status,400);
    assert.deepEqual(f.game().hostTransfer,before);
    rmSync(blocked,{recursive:true});
    assert.equal((await emit(old.s,'command',{action:'start'})).ok,true);
    assert.equal((await f.request(path+'/accept','POST',{transferToken:link.transferToken,hostToken:newKey})).status,200);
    assert.equal(f.game().hostToken,newKey);
  }finally{await f.close();}
});

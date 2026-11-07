import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {io} from 'socket.io-client';
const base='http://localhost:43187',gameId='95AF7D';
const socket=io(base,{transports:['websocket'],reconnection:false});
let state;
socket.on('state',s=>{state=s;});
const emit=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(Error(result?.error||'Command failed'))));
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await emit('subscribe',{gameId,role:'host',editing:true});
  assert.equal(state?.status,'lobby','Return the game to the lobby before editing.');
  assert.equal(state?.editLock,'mine','Another editor holds the editing lock.');
  const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);
  const before=await response.json(),rounds=structuredClone(before.rounds);
  const category=rounds[0].categories.find(c=>c.name==='Майнкрафтляндия');assert(category);
  assert.equal(category.questions.length,8);
  const changes=[];
  for(const [index,q] of category.questions.entries()){
    const value=(index+1)*100;
    if(q.value!==value)changes.push({id:q.id,answer:q.answer,from:q.value,to:value});
    q.value=value;
  }
  const expected=structuredClone(before);
  for(const q of expected.rounds[0].categories.find(c=>c.id===category.id).questions){const change=changes.find(c=>c.id===q.id);if(change)q.value=change.to;}
  assert.deepEqual({...before,rounds},expected);
  await fs.writeFile('research/game-before-minecraft-score-renumber.json',JSON.stringify(before,null,2));
  await emit('command',{action:'save',data:{rounds}});
  const after=await(await fetch(`${base}/api/games/${gameId}/export`)).json();assert.deepEqual(after,expected);
  await fs.writeFile('research/game-after-minecraft-score-renumber.json',JSON.stringify(after,null,2));
  console.log(JSON.stringify({changes,values:category.questions.map(q=>q.value),allOtherContentPreserved:true}));
}finally{socket.disconnect();}

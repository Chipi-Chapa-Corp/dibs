import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {io} from 'socket.io-client';
const base='http://localhost:43187',gameId='95AF7D',socket=io(base,{transports:['websocket'],reconnection:false});
let state;socket.on('state',value=>{state=value;});
const emit=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(Error(result?.error||'Command failed'))));
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await emit('subscribe',{gameId,role:'host',editing:true});
  if(state?.editLock!=='mine'){
    console.log('Waiting for the open editor to release its lock.');
    await new Promise((resolve,reject)=>{
      const ready=value=>{if(value.editLock==='mine'){clearTimeout(timer);socket.off('state',ready);resolve();}};
      const timer=setTimeout(()=>{socket.off('state',ready);reject(Error('Editor is still locked; no changes saved.'));},120000);
      socket.on('state',ready);
    });
  }
  const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);
  const before=await response.json(),rounds=structuredClone(before.rounds);
  const category=rounds[0].categories.find(c=>c.name==='Джим');assert(category);assert.equal(category.questions.length,4);
  for(const q of category.questions){
    assert(q.prompt.startsWith('На какую группу мышц направлено это упражнение?')||q.prompt.startsWith('Что он тренит?'),'Prompt changed; inspect before replacing.');
    q.prompt=q.prompt.replace('На какую группу мышц направлено это упражнение?','Что он тренит?');
  }
  const dir='research/gym-candidates/more-static';
  await fs.writeFile(`${dir}/game-before-gym-prompt-rename.json`,JSON.stringify(before,null,2));
  await emit('command',{action:'save',data:{rounds}});
  const after=await(await fetch(`${base}/api/games/${gameId}/export`)).json();assert.deepEqual(after.rounds,rounds);
  await fs.writeFile(`${dir}/game-after-gym-prompt-rename.json`,JSON.stringify(after,null,2));
  console.log('Saved and verified «Что он тренит?» on all four Джим questions. Images, answers and scores preserved.');
}finally{socket.disconnect();}

import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D';
const directory=`research/round-score-steps-${new Date().toISOString().replaceAll(':','-')}`;
const socket=io(base,{transports:['websocket'],reconnection:false,timeout:10000});
let state;
socket.on('state',value=>{state=value;});
const emit=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(new Error(result?.error||'Command failed'))));
const exported=async()=>{const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);return response.json();};
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await emit('subscribe',{gameId,role:'host',editing:true});
  assert.equal(state?.status,'lobby','Return the game to the lobby before editing.');
  assert.equal(state?.editLock,'mine','Another editor holds the editing lock.');
  const before=await exported(),rounds=structuredClone(before.rounds),changes=[];
  for(const [roundIndex,step] of [[1,150],[2,200]]){
    const round=rounds[roundIndex];
    assert.equal(round.type,'board');
    for(const category of round.categories){
      for(const [index,question] of category.questions.entries()){
        const value=(index+1)*step;
        if(question.value!==value)changes.push({id:question.id,round:roundIndex+1,category:category.name,from:question.value,to:value});
        question.value=value;
      }
    }
  }
  const expected={...before,rounds};
  const restored=structuredClone(expected);
  for(const round of restored.rounds)for(const category of round.categories)for(const question of category.questions){
    const original=before.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions)).find(q=>q.id===question.id);
    assert(original);
    question.value=original.value;
  }
  assert.deepEqual(restored,before,'Only question values may change.');
  assert.deepEqual(rounds[0],before.rounds[0]);
  assert.deepEqual(rounds.slice(3),before.rounds.slice(3));
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n');
  assert.deepEqual(await exported(),before,'Game changed during preparation.');
  if(changes.length)await emit('command',{action:'save',data:{rounds}});
  const after=await exported();
  assert.deepEqual(after,expected,'Saved export does not match requested changes.');
  await new Promise(resolve=>setTimeout(resolve,600));
  const persisted=JSON.parse(await fs.readFile(`data/games/${gameId}.json`,'utf8'));
  assert.deepEqual(persisted.rounds,rounds,'Saved disk data does not match.');
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n');
  await fs.writeFile(`${directory}/changes.json`,JSON.stringify(changes,null,2)+'\n');
  console.log(JSON.stringify({gameId,changed:changes.length,rounds:rounds.slice(1,3).map(r=>({name:r.name,categories:r.categories.map(c=>({name:c.name,values:c.questions.map(q=>q.value)}))})),otherContentPreserved:true,backup:directory},null,2));
}finally{socket.disconnect();}

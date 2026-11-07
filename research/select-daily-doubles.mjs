import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D';
const socket=io(base,{transports:['websocket'],reconnection:false});
let state;
socket.on('state',value=>{state=value;});
const emit=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(new Error(result?.error||'Command failed'))));
const exported=async()=>{const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);return response.json();};
try {
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await emit('subscribe',{gameId,role:'host',editing:true});
  assert.equal(state?.editLock,'mine','Another editor is open; no game changes made.');
  assert.equal(state.status,'lobby','Game must still be in preparation.');
  const before=await exported();
  const rounds=structuredClone(before.rounds);
  assert.equal(rounds[0].type,'board');
  assert(!rounds[0].categories.some(c=>c.questions.some(q=>q.dailyDouble)),'Daily Doubles already exist; refusing to add duplicates.');
  const eligible=rounds[0].categories.filter(c=>!c.questions.some(q=>q.modifier)&&c.questions.some(q=>q.prompt?.trim()));
  assert(eligible.length>=2,'Need two categories without modifiers.');
  const chosen=[];
  for(let i=0;i<2;i++) {
    const [category]=eligible.splice(randomInt(eligible.length),1);
    const questions=category.questions.filter(q=>q.prompt?.trim()&&!q.modifier&&!q.dailyDouble);
    const question=questions[randomInt(questions.length)];
    question.dailyDouble=true;
    chosen.push({category:category.name,value:question.value,id:question.id});
  }
  const directory=`research/daily-doubles-${gameId}-${new Date().toISOString().replaceAll(':','-')}`;
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n',{mode:0o600});
  const expected={...before,rounds};
  const restored=structuredClone(expected);
  for(const pick of chosen) restored.rounds[0].categories.flatMap(c=>c.questions).find(q=>q.id===pick.id).dailyDouble=false;
  assert.deepEqual(restored,before,'Only the two Daily Double flags may change.');
  assert.deepEqual(await exported(),before,'Game changed while preparing; no save performed.');
  await emit('command',{action:'save',data:{rounds}});
  const after=await exported();
  assert.deepEqual(after,expected,'Saved game differs from intended changes.');
  await new Promise(resolve=>setTimeout(resolve,500));
  const persisted=JSON.parse(await fs.readFile(`data/games/${gameId}.json`,'utf8'));
  assert.deepEqual(persisted.rounds,rounds,'Saved file differs from intended changes.');
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n',{mode:0o600});
  await fs.writeFile(`${directory}/manifest.json`,JSON.stringify({gameId,chosen},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({gameId,chosen,preservedAllQuestions:true,persisted:true},null,2));
} finally {socket.disconnect();}

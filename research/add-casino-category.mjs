import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID, randomInt} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187', gameId='95AF7D';
const socket=io(base,{transports:['websocket'],reconnection:false});
let state;
socket.on('state',value=>{state=value;});
const command=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(new Error(result?.error||'Command failed'))));
const id=()=>randomUUID().replaceAll('-','').slice(0,12);
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await command('subscribe',{gameId,role:'host',editing:true});
  assert.equal(state?.editLock,'mine','Another editor holds the editing lock.');
  const response=await fetch(`${base}/api/games/${gameId}/export`);
  assert(response.ok);
  const before=await response.json();
  assert(!before.rounds.some(r=>r.categories.some(c=>c.name==='Казино')),'Category already exists.');
  await fs.writeFile('research/game-before-casino.json',JSON.stringify(before,null,2));
  const rounds=structuredClone(before.rounds);
  assert.equal(rounds[0].type,'board');
  const answers=['зеро','красное','красное','чёрное','чёрное','чёрное'];
  for(let i=answers.length-1;i>0;i--){const j=randomInt(i+1);[answers[i],answers[j]]=[answers[j],answers[i]];}
  const category={id:id(),name:'Казино',questions:answers.map((answer,index)=>({
    id:id(),value:(index+1)*100,prompt:'Красное, чёрное или зеро?',answer,
    notes:'Угадайте заранее выбранный результат.',dailyDouble:false,modifier:null,responseType:'free',slowReveal:false
  }))};
  rounds[0].categories.push(category);
  await command('command',{action:'save',data:{rounds}});
  const after=await(await fetch(`${base}/api/games/${gameId}/export`)).json();
  assert.deepEqual(after.rounds,rounds);
  assert.deepEqual(after.rounds[0].categories.slice(0,-1),before.rounds[0].categories);
  for(const field of ['name','subtitle','settings','theme'])assert.deepEqual(after[field],before[field]);
  const installed=after.rounds[0].categories.at(-1);
  assert.equal(installed.questions.length,6);
  const counts=Object.fromEntries(['зеро','красное','чёрное'].map(answer=>[answer,installed.questions.filter(q=>q.answer===answer).length]));
  assert.deepEqual(counts,{'зеро':1,'красное':2,'чёрное':3});
  await fs.writeFile('research/game-after-casino.json',JSON.stringify(after,null,2));
  console.log(JSON.stringify({game:after.name,round:1,category:installed.name,values:installed.questions.map(q=>q.value),counts,otherCategoriesPreserved:true}));
}finally{socket.disconnect();}

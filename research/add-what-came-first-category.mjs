import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',directory='research/what-came-first';
const entries=[
  {value:200,options:['Интернет','Мобильный телефон','Кубик Рубика'],correct:0,time:3515,original:300},
  {value:400,options:['Эскалатор','Скотч','Микрофон'],correct:2,time:3334,original:600},
  {value:600,options:['Спички','Зажигалка','Термос'],correct:1,time:3172,original:900},
  {value:800,options:['Телевидение','Контактные линзы','Баскетбол'],correct:1,time:2805,original:1200},
  {value:1000,options:['Искусственное сердце','MP3-плеер','Искусственный спутник Земли'],correct:0,time:2473,original:1500},
];
const id=()=>randomUUID().replaceAll('-','').slice(0,12);
const socket=io(base,{transports:['websocket'],reconnection:false,timeout:10000});
let state;
socket.on('state',value=>{state=value;});
const emit=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(Error(result?.error||'Command failed'))));
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await emit('subscribe',{gameId,role:'host',editing:true});
  assert.equal(state?.status,'lobby','The game must be in the lobby.');
  assert.equal(state?.editLock,'mine','Another editor holds the editing lock.');
  const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);
  const before=await response.json(),rounds=structuredClone(before.rounds);
  assert.equal(before.name,'Это моя игра');
  assert.equal(rounds[1]?.type,'board');
  assert(rounds[1].categories.length<10);
  assert(!rounds.some(r=>r.categories.some(c=>c.name.toLowerCase()==='что было раньше?')),'Category already exists.');
  const category={id:id(),name:'Что было раньше?',questions:entries.map(entry=>({
    id:id(),value:entry.value,prompt:'Что появилось раньше?',answer:entry.options[entry.correct],
    answerOptions:entry.options,correctAnswerIndex:entry.correct,shuffleAnswers:true,responseType:'answer',
    notes:`Источник: «Свояк», Данила Горилла / Макс 100500 / Сатир, раунд 3.\nhttps://www.youtube.com/watch?v=tXEM3FSfsWc&t=${entry.time}s\nИсходная стоимость: ${entry.original}. Ответ — как засчитано в выпуске.`,
    dailyDouble:false,modifier:null,slowReveal:false,
  }))};
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n');
  rounds[1].categories.push(category);
  await emit('command',{action:'save',data:{rounds}});
  const exported=await fetch(`${base}/api/games/${gameId}/export`);assert(exported.ok);
  const after=await exported.json();assert.deepEqual(after.rounds,rounds);
  const unchanged=structuredClone(after);unchanged.rounds[1].categories.pop();assert.deepEqual(unchanged,before);
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n');
  console.log(JSON.stringify({game:after.name,round:2,category:category.name,questions:category.questions.map(({value,answer,answerOptions})=>({value,answer,answerOptions})),otherContentPreserved:true}));
}finally{socket.disconnect();}

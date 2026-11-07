import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',directory='research/anagrams';
const sourceRoot='/var/folders/t3/wh0_r9jx0jz4kqxrwpsvv5rh0000gn/T';
const entries=[
  {letters:'ООТЗРМ',answer:'Тормоз',first:'Т',file:'codex-clipboard-42b737eb-f80b-46d6-9257-e498615c8c4d.png',video:'S_RgvOA7CpE',time:794},
  {letters:'ркжаПеддо',answer:'Поддержка',file:'codex-clipboard-3189c323-ac33-4ec5-89de-12b885dfef65.png',video:'sirgbkwjbPk',time:1484},
  {letters:'МИГОАРКЛМ',answer:'Килограмм',first:'К',file:'codex-clipboard-4aa26c0a-fd1f-4cfe-8d05-9ccbb7183f60.png',video:'S_RgvOA7CpE',time:1124},
  {letters:'ДАЬМВЕРУ',answer:'Муравьед',first:'М',file:'codex-clipboard-7651e752-d915-43d0-8460-5f7bd542e49c.png',video:'S_RgvOA7CpE',time:622},
  {letters:'жОанлхиеед',answer:'Охлаждение',file:'codex-clipboard-79c4bb28-67d2-444d-b4df-1caa9a5010e1.png',video:'sirgbkwjbPk',time:1287},
  {letters:'рТияортреи',answer:'Территория',file:'codex-clipboard-261715bc-79fc-4604-b0b9-74dd39650c25.png',video:'sirgbkwjbPk',time:1233},
  {letters:'иПупороводнкл',answer:'Полупроводник',file:'codex-clipboard-04da01f5-846f-4068-aef9-056e36fce388.png',video:'sirgbkwjbPk',time:1173},
];
const lettersOf=s=>[...s.toLowerCase()].sort().join('');
for(const e of entries){
  assert.equal(lettersOf(e.letters),lettersOf(e.answer),`Invalid anagram: ${e.letters}`);
  if(e.first)assert.equal(e.first,e.answer[0]);
  else assert.equal([...e.letters].filter(c=>c!==c.toLowerCase()).join(''),e.answer[0]);
}
await fs.mkdir(directory,{recursive:true});
for(const [index,e] of entries.entries()){
  e.value=(index+1)*200;
  e.original=`${directory}/original-${index+1}.png`;
  await fs.copyFile(`${sourceRoot}/${e.file}`,e.original);
}
await fs.writeFile(`${directory}/questions.json`,JSON.stringify(entries,null,2)+'\n');
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
  assert(!rounds.some(r=>r.categories.some(c=>c.name.toLowerCase()==='анаграммы')),'Category already exists.');
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n');
  const category={id:id(),name:'Анаграммы',questions:entries.map(e=>({
    id:id(),value:e.value,
    prompt:e.first?`Составьте слово.\n\n## ${e.letters}\n\nПервая буква: **${e.first}**`:`Составьте слово. Заглавная буква — первая.\n\n## ${e.letters}`,
    answer:e.answer,notes:`Буквы и регистр точно переписаны со скриншота пользователя.\nИсточник: https://www.youtube.com/watch?v=${e.video}&t=${e.time}s\nСкриншот-источник: ${e.original}`,
    dailyDouble:false,modifier:null,responseType:'free',slowReveal:false,
  }))};
  rounds[1].categories.push(category);
  await emit('command',{action:'save',data:{rounds}});
  const exported=await fetch(`${base}/api/games/${gameId}/export`);assert(exported.ok);
  const after=await exported.json();assert.deepEqual(after.rounds,rounds);
  const unchanged=structuredClone(after);unchanged.rounds[1].categories.pop();assert.deepEqual(unchanged,before);
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n');
  console.log(JSON.stringify({game:after.name,round:2,category:category.name,questions:entries.map(({value,letters,answer})=>({value,letters,answer})),otherContentPreserved:true,allLetterCountsVerified:true}));
}finally{socket.disconnect();}

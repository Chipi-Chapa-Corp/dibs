import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',directory='research/anagrams';
const replacements=new Map([['Тормоз','ооТзрм'],['Килограмм','мигоарКлм'],['Муравьед','даьМверу']]);
const lettersOf=s=>[...s.toLowerCase()].sort().join('');
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
  const category=rounds[1].categories.find(c=>c.name==='Анаграммы');assert(category);
  const changed=[];
  for(const q of category.questions){
    const letters=replacements.get(q.answer);if(!letters)continue;
    assert.equal(lettersOf(letters),lettersOf(q.answer));
    assert.equal([...letters].filter(c=>c!==c.toLowerCase()).join(''),q.answer[0]);
    const original=q.prompt.match(/^## (.+)$/m)?.[1];assert(original);
    assert.equal(letters.toLowerCase(),original.toLowerCase(),'Letter order must remain unchanged.');
    q.prompt=`Составьте слово. Заглавная буква — первая.\n\n## ${letters}`;
    q.notes=q.notes.replace('Буквы и регистр точно переписаны со скриншота пользователя.','Порядок букв сохранён со скриншота пользователя. Подсказка первой буквы передана заглавной буквой внутри анаграммы.');
    changed.push({answer:q.answer,letters});
  }
  assert.equal(changed.length,3);
  await fs.writeFile(`${directory}/capitalization-before.json`,JSON.stringify(before,null,2)+'\n');
  await emit('command',{action:'save',data:{rounds}});
  const exported=await fetch(`${base}/api/games/${gameId}/export`);assert(exported.ok);
  const after=await exported.json();assert.deepEqual(after,{...before,rounds});
  await fs.writeFile(`${directory}/capitalization-after.json`,JSON.stringify(after,null,2)+'\n');
  console.log(JSON.stringify({round:2,category:category.name,changed,verified:true}));
}finally{socket.disconnect();}

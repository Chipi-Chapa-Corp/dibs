import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';
const base='http://localhost:43187',gameId='95AF7D',directory='research/gym-candidates';
const choices=[
  {exercise:'Tate_Press',title:'Жим Тейта',answer:'Трицепс',file:`${directory}/Tate_Press-0.jpg`,accepted:['трицепс','трицепсы']},
  {exercise:'Svend_Press',title:'Жим Свенда',answer:'Грудь',file:`${directory}/harder/Svend_Press.jpg`,accepted:['грудь','грудные мышцы']},
  {exercise:'Wrist_Roller',title:'Наматывание груза на валик',answer:'Предплечья',file:`${directory}/more-static/Wrist_Roller.jpg`,accepted:['предплечья','хват','запястье']}
];
const socket=io(base,{transports:['websocket'],reconnection:false});let state;
socket.on('state',value=>{state=value;});
const emit=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(Error(result?.error||'Command failed'))));
const id=()=>randomUUID().replaceAll('-','').slice(0,12),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await emit('subscribe',{gameId,role:'host',editing:true});assert.equal(state?.editLock,'mine','Another editor holds the editing lock.');
  const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);const before=await response.json(),rounds=structuredClone(before.rounds);
  const category=rounds[0].categories.find(c=>c.name==='Джим');assert(category);assert.equal(category.questions.length,4,'Inspect changed category before appending.');
  assert(!category.questions.some(q=>choices.some(c=>q.notes?.includes(`/${c.exercise}.json`))),'Question already present.');
  await fs.writeFile(`${directory}/game-before-three-gym-additions.json`,JSON.stringify(before,null,2));
  const nextValue=Math.max(...category.questions.map(q=>q.value))+100;
  for(const [index,choice] of choices.entries()){
    const bytes=await fs.readFile(choice.file);choice.sha256=hash(bytes);choice.value=nextValue+100*index;
    const form=new FormData();form.append('file',new Blob([bytes],{type:'image/jpeg'}),`exercise-${index+5}.jpg`);
    const upload=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'X-Editor-Id':socket.id},body:form});const asset=await upload.json();assert(upload.ok&&asset.url,asset.error||'Upload failed');
    choice.mediaUrl=asset.url;choice.source=`https://github.com/yuhonas/free-exercise-db/blob/main/exercises/${choice.exercise}.json`;
    category.questions.push({id:id(),value:choice.value,prompt:`Что он тренит?\n\n![Упражнение](${asset.url})`,answer:choice.answer,notes:`Упражнение: ${choice.title}.\nОсновная целевая группа: ${choice.answer}.\nЗасчитывать: ${choice.accepted.join(' / ')}.${choice.exercise==='Wrist_Roller'?'\n«Хват» и «запястье» принимаются как разговорные ответы по правилам этой игры.':''}\nИсточник: ${choice.source}`,dailyDouble:false,modifier:null,responseType:'free',slowReveal:true});
  }
  await emit('command',{action:'save',data:{rounds}});
  const after=await(await fetch(`${base}/api/games/${gameId}/export`)).json();assert.deepEqual(after.rounds,rounds);
  const installed=after.rounds[0].categories.find(c=>c.id===category.id);assert.equal(installed.questions.length,7);
  assert.deepEqual(installed.questions.slice(0,4),before.rounds[0].categories.find(c=>c.id===category.id).questions);
  assert.deepEqual(after.rounds[0].categories.filter(c=>c.id!==category.id),before.rounds[0].categories.filter(c=>c.id!==category.id));
  for(const field of ['name','subtitle','settings','theme'])assert.deepEqual(after[field],before[field]);
  for(const choice of choices){const media=await fetch(base+choice.mediaUrl);assert(media.ok&&media.headers.get('content-type')?.startsWith('image/jpeg'));assert.equal(hash(Buffer.from(await media.arrayBuffer())),choice.sha256);}
  const wrist=installed.questions.at(-1);for(const alias of ['предплечья','хват','запястье'])assert(wrist.notes.toLowerCase().includes(alias));
  assert(installed.questions.every(q=>q.slowReveal===true&&q.prompt.startsWith('Что он тренит?')));
  await fs.writeFile(`${directory}/game-after-three-gym-additions.json`,JSON.stringify(after,null,2));await fs.writeFile(`${directory}/installed-three-gym-additions.json`,JSON.stringify(choices,null,2));
  console.log(JSON.stringify({category:installed.name,total:installed.questions.length,added:choices.map(({title,value,answer,accepted})=>({title,value,answer,accepted})),slowReveal:true,existingQuestionsPreserved:true,imagesVerified:true}));
}finally{socket.disconnect();}

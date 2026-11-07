import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',directory='research/gym-candidates/more-static';
const choices=[
  {exercise:'Overhead_Cable_Curl',answer:'Бицепс',value:100,file:'Overhead_Cable_Curl.jpg',title:'Сгибания рук на верхних блоках',accepted:'Бицепс, бицепсы.'},
  {exercise:'Frog_Sit-Ups',answer:'Пресс',value:200,file:'Frog_Sit-Ups-1.jpg',title:'Скручивания «лягушка»',accepted:'Пресс, мышцы живота.'},
  {exercise:'Barbell_Seated_Calf_Raise',answer:'Икры',value:300,file:'Barbell_Seated_Calf_Raise.jpg',title:'Подъёмы на носки сидя со штангой',accepted:'Икры, икроножные, камбаловидные мышцы.'},
  {exercise:'Pull_Through',answer:'Ягодицы',value:400,file:'Pull_Through-0.jpg',title:'Протяжка каната между ног',accepted:'Ягодицы, ягодичные мышцы.'}
];
const socket=io(base,{transports:['websocket'],reconnection:false});
let state;
socket.on('state',value=>{state=value;});
const command=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(new Error(result?.error||'Command failed'))));
const id=()=>randomUUID().replaceAll('-','').slice(0,12);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await command('subscribe',{gameId,role:'host',editing:true});
  assert.equal(state?.editLock,'mine','Another editor holds the editing lock.');
  const response=await fetch(`${base}/api/games/${gameId}/export`);
  assert(response.ok);
  const before=await response.json();
  assert(!before.rounds.some(r=>r.categories.some(c=>c.name==='Джим')),'Джим already exists; inspect before changing.');
  await fs.writeFile(`${directory}/game-before-gym.json`,JSON.stringify(before,null,2));
  const rounds=structuredClone(before.rounds);
  assert.equal(rounds[0].type,'board');
  const category={id:id(),name:'Джим',questions:[]};
  for(const [index,choice] of choices.entries()){
    const bytes=await fs.readFile(`${directory}/${choice.file}`);
    choice.sha256=hash(bytes);
    const form=new FormData();
    form.append('file',new Blob([bytes],{type:'image/jpeg'}),`exercise-${index+1}.jpg`);
    const uploaded=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'X-Editor-Id':socket.id},body:form});
    const media=await uploaded.json();
    assert(uploaded.ok&&media.url,media.error||'Image upload failed');
    choice.mediaUrl=media.url;
    choice.source=`https://github.com/yuhonas/free-exercise-db/blob/main/exercises/${choice.exercise}.json`;
    category.questions.push({id:id(),value:choice.value,prompt:`На какую группу мышц направлено это упражнение?\n\n![Упражнение](${media.url})`,answer:choice.answer,notes:`Упражнение: ${choice.title}.\nОсновная целевая группа: ${choice.answer}.\nЗасчитывать: ${choice.accepted}\nИсточник: ${choice.source}`,dailyDouble:false,modifier:null,responseType:'free',slowReveal:false});
  }
  rounds[0].categories.push(category);
  await command('command',{action:'save',data:{rounds}});
  const after=await(await fetch(`${base}/api/games/${gameId}/export`)).json();
  assert.deepEqual(after.rounds,rounds);
  assert.deepEqual(after.rounds[0].categories.slice(0,-1),before.rounds[0].categories);
  for(const field of ['name','subtitle','settings','theme'])assert.deepEqual(after[field],before[field]);
  assert.equal(category.questions.length,4);
  for(const choice of choices){
    const image=await fetch(base+choice.mediaUrl);
    assert(image.ok&&image.headers.get('content-type')?.startsWith('image/jpeg'));
    assert.equal(hash(Buffer.from(await image.arrayBuffer())),choice.sha256);
  }
  await fs.writeFile(`${directory}/game-after-gym.json`,JSON.stringify(after,null,2));
  await fs.writeFile(`${directory}/installed-gym.json`,JSON.stringify({gameId,categoryId:category.id,categoryName:category.name,questions:choices},null,2));
  console.log(JSON.stringify({game:after.name,round:1,category:category.name,questions:category.questions.map(({value,answer})=>({value,answer})),imagesVerified:true,otherCategoriesPreserved:true}));
}finally{socket.disconnect();}

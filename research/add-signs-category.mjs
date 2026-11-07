import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',directory='research/signs';
const clipboard='/var/folders/t3/wh0_r9jx0jz4kqxrwpsvv5rh0000gn/T/';
const entries=[
  {value:300,answer:'Кофе с булочкой',file:'codex-clipboard-def7757b-c8c1-4dbb-bea6-1ecb51c7115d.png',video:'kiusnXwLDtU',time:1508,explanation:'Прочитать строки сверху вниз: КО / ФЕ / СБ / УЛ / ОЧ / КО / Й.'},
  {value:600,answer:'Приятного аппетита!',file:'codex-clipboard-6f634f70-ea58-4817-a35d-57eff8906752.png',video:'kiusnXwLDtU',time:1521,explanation:'Прочитать последовательно сверху вниз, объединяя разбитые части слов.'},
  {value:900,answer:'Для бытового мусора',file:'codex-clipboard-79158a53-2c2d-43db-a743-1d0ee0808ba1.png',video:'IXKrQNv2Cb8',time:800,explanation:'Начать с правого контейнера: «ДЛЯ / БЫТОВ / МУ», затем дополнить частями с левого: «ОГО / СОРА».'},
  {value:1200,answer:'Глобальное падение цен!',file:'codex-clipboard-80206611-0479-47dc-bbd4-a17c3b201703.png',video:'1cqpwzmA3EQ',time:3424,explanation:'Левый столбец: «ГЛ / ОБ / АЛ / ЬН / ОЕ». Правый: «ПА / ДЕ / НИ / Е / ЦЕ / Н».'},
  {value:1500,answer:'«Горизонт». Мы ищем вожатых!',file:'codex-clipboard-a6e1dbea-95ab-43d4-826b-b1576a324a13.png',video:'IXKrQNv2Cb8',time:428,explanation:'Название «ГОРИЗОНТ» разбито вставкой «МЫ», а «ВОЖАТЫХ» — вставкой «ИЩЕМ». Засчитывать правильную фразу с названием «Горизонт» без требования дословной пунктуации.'},
  {value:1800,answer:'Растормаживание речи',file:'codex-clipboard-73df6f17-2de6-4f36-8789-2538d7ff35d0.png',video:'KCTGsqOPjts',time:1376,explanation:'Первое слово идёт по диагонали вниз, затем продолжается снизу вверх; «РЕЧИ» находится в центре.'},
  {value:2100,answer:'Распродажа платьев',file:'codex-clipboard-f6564d0a-f135-45e6-a5ef-c57cc5b92570.png',video:'kiusnXwLDtU',time:1179,explanation:'На левой створке двери зашифровано «РАСПРОДАЖА», на правой — «ПЛАТЬЕВ».'},
  {value:2400,answer:'Ликвидация одежды',file:'codex-clipboard-0be33361-33b2-4291-af85-8b2ae644e33c.png',video:'KCTGsqOPjts',time:1353,explanation:'По краям повторяется «ЛИКВИДАЦИЯ», по центру — «ОДЕЖДЫ». Засчитывать «ликвидация одежды»; повторять слово «ликвидация» дважды не требуется.'},
];
assert.equal(entries.length,8);
const id=()=>randomUUID().replaceAll('-','').slice(0,12);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Validate all local inputs before opening an editor session or uploading media.
const inputs=await Promise.all(entries.map(async entry=>{
  const original=clipboard+entry.file,bytes=await fs.readFile(original);
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  return {entry,original,bytes,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:hash(bytes)};
}));
assert.equal(new Set(inputs.map(x=>x.sha256)).size,8);
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
  assert.equal(rounds[2]?.type,'board');assert(rounds[2].categories.length<10);
  assert(!rounds.some(r=>r.categories.some(c=>c.name.toLowerCase()==='упоротые вывески')),'Category already exists.');
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n');
  const category={id:id(),name:'Упоротые вывески',questions:[]},assets=[];
  for(const [index,input]of inputs.entries()){
    const {entry,original,bytes,width,height,sha256}=input;
    const file=`${directory}/question-${String(index+1).padStart(2,'0')}.png`;
    await fs.writeFile(file,bytes);
    const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),`signs-${index+1}.png`);
    const upload=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'X-Editor-Id':socket.id},body:form});
    const media=await upload.json();assert(upload.ok&&media.url,media.error||'Upload failed');
    const served=await fetch(base+media.url);assert(served.ok&&served.headers.get('content-type')?.startsWith('image/png'));
    assert.equal(hash(Buffer.from(await served.arrayBuffer())),sha256);
    assets.push({value:entry.value,answer:entry.answer,original,file,width,height,sha256,mediaUrl:media.url});
    category.questions.push({id:id(),value:entry.value,prompt:`Что здесь написано?\n\n![Вывеска](${media.url})`,answer:entry.answer,
      notes:`${entry.explanation}\nИсточник: «Свояк». https://www.youtube.com/watch?v=${entry.video}&t=${entry.time}s\nСкриншот предоставлен пользователем; исходное расположение букв сохранено без изменений. Изображение показывается целиком.`,
      dailyDouble:false,modifier:null,responseType:'free',slowReveal:false});
  }
  rounds[2].categories.push(category);
  await emit('command',{action:'save',data:{rounds}});
  const exported=await fetch(`${base}/api/games/${gameId}/export`);assert(exported.ok);
  const after=await exported.json();assert.deepEqual(after.rounds,rounds);
  const unchanged=structuredClone(after);unchanged.rounds[2].categories.pop();assert.deepEqual(unchanged,before);
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n');
  await fs.writeFile(`${directory}/assets.json`,JSON.stringify(assets,null,2)+'\n');
  console.log(JSON.stringify({game:after.name,round:3,category:category.name,questions:category.questions.map(({value,answer,slowReveal})=>({value,answer,slowReveal})),otherContentPreserved:true,imagesVerified:assets.length}));
}finally{socket.disconnect();}

import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',directory='research/kinopaint';
const assets=JSON.parse(await fs.readFile(`${directory}/assets.json`,'utf8'));
const socket=io(base,{transports:['websocket'],reconnection:false});
let state;
socket.on('state',value=>{state=value;});
const emit=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(Error(result?.error||'Command failed'))));
const id=()=>randomUUID().replaceAll('-','').slice(0,12);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await emit('subscribe',{gameId,role:'host',editing:true});
  assert.equal(state?.editLock,'mine','Another editor holds the editing lock.');
  const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);
  const before=await response.json(),rounds=structuredClone(before.rounds);
  assert.equal(rounds[0].type,'board');
  assert(!rounds.some(r=>r.categories?.some(c=>c.name.toLowerCase()==='кинопейнт')),'Category already exists.');
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2));
  const category={id:id(),name:'Кинопейнт',questions:[]};
  for(const [index,asset] of assets.entries()){
    assert.equal(asset.value,(index+1)*100);
    const bytes=await fs.readFile(asset.file);asset.sha256=hash(bytes);
    const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),`drawing-${index+1}.png`);
    const upload=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'X-Editor-Id':socket.id},body:form});
    const media=await upload.json();assert(upload.ok&&media.url,media.error||'Upload failed');asset.mediaUrl=media.url;
    category.questions.push({id:id(),value:asset.value,prompt:`Какой фильм нарисован?\n\n![Рисунок](${media.url})`,answer:asset.answer,notes:`Источник: https://www.youtube.com/watch?v=DMo3G4s_5vs&t=${asset.timestamp}s\nСкриншот предоставлен пользователем. Удалена рамка и улучшена чёткость встроенным image_gen; сохранён исходный стиль Paint.\nИсходная стоимость: ${asset.value*2}.`,dailyDouble:false,modifier:null,responseType:'free',slowReveal:true});
  }
  rounds[0].categories.push(category);
  await emit('command',{action:'save',data:{rounds}});
  const after=await(await fetch(`${base}/api/games/${gameId}/export`)).json();assert.deepEqual(after.rounds,rounds);
  const expected=structuredClone(after);expected.rounds[0].categories.pop();assert.deepEqual(expected,before);
  assert.deepEqual(category.questions.map(q=>q.value),[100,200,300,400,500]);
  for(const asset of assets){const media=await fetch(base+asset.mediaUrl);assert(media.ok&&media.headers.get('content-type')?.startsWith('image/png'));assert.equal(hash(Buffer.from(await media.arrayBuffer())),asset.sha256);}
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2));
  await fs.writeFile(`${directory}/assets.json`,JSON.stringify(assets,null,2));
  console.log(JSON.stringify({category:category.name,questions:category.questions.map(({value,answer,slowReveal})=>({value,answer,slowReveal})),otherContentPreserved:true,imagesVerified:true}));
}finally{socket.disconnect();}

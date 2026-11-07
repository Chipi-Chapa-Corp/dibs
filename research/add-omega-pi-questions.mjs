import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D';
const root='research/greek-letters',directory=`${root}/omega-pi-additions`;
const candidates=JSON.parse(await fs.readFile(`${root}/candidates/sources.json`,'utf8'));
const additions=[
  {answer:'Омега',value:1200,accepted:'омега, omega, ω, Ω',explanation:'Капсулы рыбьего жира → омега-3.'},
  {answer:'Пи',value:1400,accepted:'пи, pi, π, Π',explanation:'Логотип Raspberry Pi. Автор значка: Terence Eden, CC BY 4.0; https://creativecommons.org/licenses/by/4.0/ . Изображение без изменений.'},
];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const id=()=>randomUUID().replaceAll('-','').slice(0,12);
const socket=io(base,{transports:['websocket'],reconnection:false,timeout:10000});
let state;
socket.on('state',value=>{state=value;});
const emit=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(Error(result?.error||'Command failed'))));
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await emit('subscribe',{gameId,role:'host',editing:true});
  assert.equal(state?.status,'lobby');
  assert.equal(state?.editLock,'mine','Another editor holds the editing lock.');
  const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);
  const before=await response.json(),rounds=structuredClone(before.rounds);
  assert.equal(before.name,'Это моя игра');
  const category=rounds[1]?.categories.find(c=>c.name==='Греческие буквы');
  assert(category,'Category must exist in round 2.');
  assert.deepEqual(category.questions.map(q=>q.value),[200,400,600,800,1000]);
  assert(!category.questions.some(q=>additions.some(a=>a.answer===q.answer)),'Questions already exist.');
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n');
  const assets=[];
  for(const addition of additions){
    const candidate=candidates.find(a=>a.answer===addition.answer);assert(candidate);
    const file=`${root}/candidates/${candidate.file}`,bytes=await fs.readFile(file);
    const type=candidate.file.endsWith('.png')?'image/png':'image/jpeg';
    const form=new FormData();form.append('file',new Blob([bytes],{type}),candidate.file);
    const upload=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'X-Editor-Id':socket.id},body:form});
    const media=await upload.json();assert(upload.ok&&media.url,media.error||'Upload failed');
    assets.push({...candidate,file,value:addition.value,mediaUrl:media.url,sha256:hash(bytes)});
    category.questions.push({id:id(),value:addition.value,prompt:`Какая греческая буква зашифрована на картинке?\n\n![Подсказка](${media.url})`,answer:addition.answer,notes:`Засчитывать: ${addition.accepted}.\n${addition.explanation}\nДополнительный авторский вопрос; не из «Свояка».\nИсточник изображения: ${candidate.url}\nСтраница источника: ${addition.answer==='Омега'?candidate.url:candidate.source}`,dailyDouble:false,modifier:null,responseType:'free',slowReveal:true});
  }
  await emit('command',{action:'save',data:{rounds}});
  const saved=await fetch(`${base}/api/games/${gameId}/export`);assert(saved.ok);
  const after=await saved.json();assert.deepEqual(after.rounds,rounds);
  const unchanged=structuredClone(after);
  unchanged.rounds[1].categories.find(c=>c.id===category.id).questions.splice(-additions.length);
  assert.deepEqual(unchanged,before,'Existing game content must be preserved.');
  for(const asset of assets){
    const image=await fetch(base+asset.mediaUrl);
    assert(image.ok&&image.headers.get('content-type')?.startsWith('image/'));
    assert.equal(hash(Buffer.from(await image.arrayBuffer())),asset.sha256);
  }
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n');
  await fs.writeFile(`${directory}/assets.json`,JSON.stringify(assets,null,2)+'\n');
  console.log(JSON.stringify({game:after.name,round:2,category:category.name,added:additions.map(({value,answer})=>({value,answer})),questionCount:category.questions.length,slowReveal:true,imagesVerified:true,otherContentPreserved:true}));
}finally{socket.disconnect();}

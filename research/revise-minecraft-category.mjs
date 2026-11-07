import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',directory='research/minecraft-images';
const ranking=['Прага','Лондон','Париж','Сидней','Рим','Рио-де-Жанейро','Сан-Франциско','Вашингтон','Берлин'];
const details={
  'Париж':{landmark:'Триумфальная арка',seconds:512},
  'Вашингтон':{landmark:'Монумент Вашингтону, мемориалы Линкольна и Джефферсона',seconds:1272},
  'Сан-Франциско':{landmark:'Мост Золотые Ворота',seconds:1206},
  'Берлин':{landmark:'Бранденбургские ворота',seconds:1119}
};
const assets=JSON.parse(await fs.readFile(`${directory}/four-city-restorations.json`,'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const socket=io(base,{transports:['websocket'],reconnection:false});
let state;
socket.on('state',value=>{state=value;});
const command=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(new Error(result?.error||'Command failed'))));
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await command('subscribe',{gameId,role:'host',editing:true});
  assert.equal(state?.editLock,'mine','The editor is still open in another window.');
  const exported=await fetch(`${base}/api/games/${gameId}/export`);
  assert(exported.ok);
  const before=await exported.json();
  await fs.writeFile(`${directory}/game-before-four-city-additions.json`,JSON.stringify(before,null,2));
  const rounds=structuredClone(before.rounds);
  const category=rounds[0].categories.find(c=>c.name==='Майнкрафтляндия');
  assert(category,'Category missing');
  assert.equal(category.questions.length,7,'Category has changed; inspect before revising.');
  const originalQuestions=new Map(category.questions.map(q=>[q.answer,q]));
  assert(originalQuestions.has('Нью-Йорк')&&originalQuestions.has('Дубай'));
  for(const asset of assets){
    assert(!originalQuestions.has(asset.city),`Already exists: ${asset.city}`);
    const bytes=await fs.readFile(asset.path);
    asset.sha256=hash(bytes);
    const form=new FormData();
    form.append('file',new Blob([bytes],{type:'image/png'}),`${asset.name}-restored.png`);
    const uploaded=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'x-editor-id':socket.id},body:form});
    const media=await uploaded.json();
    if(!uploaded.ok||!media.url)throw new Error(media.error||'Image upload failed');
    asset.mediaUrl=media.url;
    asset.source=`https://www.youtube.com/watch?v=jchmb6wygG4&t=${details[asset.city].seconds}s`;
    originalQuestions.set(asset.city,{id:randomUUID().replaceAll('-','').slice(0,12),value:0,prompt:`Какой город воссоздан в Minecraft?\n\n![Город в Minecraft](${media.url})`,answer:asset.city,notes:`Ориентир: ${details[asset.city].landmark}\nИсточник: ${asset.source}\nСкриншот предоставлен пользователем. Удалена рамка и улучшена чёткость встроенным image_gen; оригинал сохранён.`,dailyDouble:false,modifier:null,responseType:'free',slowReveal:true});
  }
  category.questions=ranking.map((city,index)=>{
    assert(originalQuestions.has(city),`Missing: ${city}`);
    return{...originalQuestions.get(city),value:(index+1)*100};
  });
  await command('command',{action:'save',data:{rounds}});
  const after=await(await fetch(`${base}/api/games/${gameId}/export`)).json();
  const installed=after.rounds[0].categories.find(c=>c.id===category.id);
  assert.deepEqual(installed,category);
  assert.deepEqual(after.rounds[0].categories.filter(c=>c.id!==category.id),before.rounds[0].categories.filter(c=>c.id!==category.id));
  assert.deepEqual(after.rounds.slice(1),before.rounds.slice(1));
  for(const field of ['name','subtitle','settings','theme'])assert.deepEqual(after[field],before[field]);
  assert(!installed.questions.some(q=>['Нью-Йорк','Дубай'].includes(q.answer)));
  for(const city of ['Прага','Лондон','Сидней','Рим','Рио-де-Жанейро']){
    const old=before.rounds[0].categories.find(c=>c.id===category.id).questions.find(q=>q.answer===city);
    const current=installed.questions.find(q=>q.answer===city);
    assert.deepEqual({...current,value:old.value},old,`Retained question changed: ${city}`);
  }
  for(const q of installed.questions){
    const url=q.prompt.match(/\]\(([^)]+)\)/)?.[1];
    const response=await fetch(base+url);
    assert(response.ok&&response.headers.get('content-type')?.startsWith('image/'),`Image unavailable: ${q.answer}`);
    const asset=assets.find(a=>a.city===q.answer);
    if(asset)assert.equal(hash(Buffer.from(await response.arrayBuffer())),asset.sha256);
  }
  await fs.writeFile(`${directory}/four-city-restorations.json`,JSON.stringify(assets,null,2));
  await fs.writeFile(`${directory}/game-after-four-city-additions.json`,JSON.stringify(after,null,2));
  const manifest=JSON.parse(await fs.readFile('research/minecraft-city-candidates.json','utf8'));
  manifest.removedCandidates=manifest.candidates.filter(a=>['Нью-Йорк','Дубай'].includes(a.city));
  manifest.candidates=ranking.map((city,index)=>({...manifest.candidates.find(a=>a.city===city),...assets.find(a=>a.city===city),city,value:(index+1)*100}));
  manifest.notes='Installed category revised per user request: New York and Dubai removed due to image quality; Prague moved to 100. Added restored screenshots of Paris, Washington, San Francisco and Berlin. Nine questions worth 100–900, with free responses and slow reveal. Removed media retained for recovery; existing retained question content preserved.';
  await fs.writeFile('research/minecraft-city-candidates.json',JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({category:installed.name,questions:installed.questions.map(({value,answer})=>({value,answer})),allImagesVerified:true,otherCategoriesPreserved:true},null,2));
}finally{socket.disconnect();}

import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',categoryName='Майнкрафтляндия';
const directory='research/minecraft-images';
const manifest=JSON.parse(await fs.readFile('research/minecraft-city-candidates.json','utf8'));
const slugs=['london','new-york','sydney','rome','rio','dubai','prague'];
const browserDownloads={
  'Нью-Йорк':{path:'/Users/mychkvad/Downloads/17822066_l.webp',type:'image/webp'},
  'Сидней':{path:'/var/folders/t3/wh0_r9jx0jz4kqxrwpsvv5rh0000gn/T/browser-use/assets/f08593af-30bf-446d-bc21-47580808ecd0/8e757566ee89aadb.webp',type:'image/webp'},
  'Дубай':{path:'/Users/mychkvad/Downloads/12695053_l.webp',type:'image/webp'},
  'Прага':{path:'/Users/mychkvad/Downloads/prague_610444403_lrg.jpg',type:'image/jpeg'}
};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(directory,{recursive:true});
const downloads=await Promise.allSettled(manifest.candidates.map(async(candidate,index)=>{
  const local=browserDownloads[candidate.city];
  const response=local?null:await fetch(candidate.image,{signal:AbortSignal.timeout(30000)});
  if(response&&!response.ok)throw new Error(`${candidate.city}: image returned ${response.status}`);
  const rawType=local?.type??response.headers.get('content-type')?.split(';')[0];
  const type=rawType==='image/jpg'?'image/jpeg':rawType;
  const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[type];
  if(!extension)throw new Error(`${candidate.city}: unsupported content type ${type}`);
  const bytes=local?await fs.readFile(local.path):Buffer.from(await response.arrayBuffer());
  if(bytes.length<1000)throw new Error(`${candidate.city}: empty image`);
  const path=`${directory}/${slugs[index]}.${extension}`;
  await fs.writeFile(path,bytes);
  return{...candidate,path,type,sha256:hash(bytes),value:(index+1)*100};
}));
for(const result of downloads)if(result.status==='rejected')console.error(result.reason);
if(downloads.some(result=>result.status==='rejected'))throw new Error('Resolve image downloads before changing the game.');
const assets=downloads.map(result=>result.value);

const socket=io(base,{transports:['websocket'],reconnection:false});
let state;
socket.on('state',value=>{state=value;});
const command=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(new Error(result?.error||'Command failed'))));
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await command('subscribe',{gameId,role:'host',editing:true});
  if(state?.editLock!=='mine')throw new Error('The game editor is open in another window.');
  const exported=await fetch(`${base}/api/games/${gameId}/export`);
  assert(exported.ok,'Could not export game');
  const before=await exported.json();
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2));
  const rounds=structuredClone(before.rounds);
  assert.equal(rounds[0].type,'board');
  assert(!rounds[0].categories.some(category=>category.name===categoryName),'Category already exists; inspect before adding.');
  const category={id:randomUUID().replaceAll('-','').slice(0,12),name:categoryName,questions:[]};
  for(const asset of assets){
    const form=new FormData();
    form.append('file',new Blob([await fs.readFile(asset.path)],{type:asset.type}),asset.path.split('/').at(-1));
    const uploaded=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'x-editor-id':socket.id},body:form});
    const media=await uploaded.json();
    if(!uploaded.ok||!media.url)throw new Error(media.error||`Upload failed for ${asset.city}`);
    asset.mediaUrl=media.url;
    category.questions.push({id:randomUUID().replaceAll('-','').slice(0,12),value:asset.value,prompt:`Какой город воссоздан в Minecraft?\n\n![Город в Minecraft](${media.url})`,answer:asset.city,notes:`Ориентир: ${asset.landmark}\nАвтор: ${asset.creator}\nИсточник: ${asset.source}\nИзображение: ${asset.image}`,dailyDouble:false,modifier:null,responseType:'free',slowReveal:true});
  }
  rounds[0].categories.push(category);
  await command('command',{action:'save',data:{rounds}});
  const after=await(await fetch(`${base}/api/games/${gameId}/export`)).json();
  const installed=after.rounds[0].categories.find(item=>item.id===category.id);
  assert.deepEqual(installed,category,'Saved category differs');
  assert.deepEqual(after.rounds[0].categories.filter(item=>item.id!==category.id),before.rounds[0].categories,'Existing categories changed');
  assert.deepEqual(after.rounds.slice(1),before.rounds.slice(1));
  for(const field of ['name','subtitle','settings','theme'])assert.deepEqual(after[field],before[field]);
  for(const asset of assets){
    const response=await fetch(base+asset.mediaUrl);
    assert(response.ok&&response.headers.get('content-type')?.startsWith('image/'),`Image unavailable: ${asset.city}`);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())),asset.sha256,`Image changed: ${asset.city}`);
  }
  manifest.notes='Installed in Это моя игра (95AF7D), Round 1, Майнкрафтляндия. Seven actual Minecraft build images, saved locally and uploaded to game media. Values 100–700 in listed order, free response and slow reveal enabled. Original source/creator credits stored in private host notes.';
  manifest.candidates=assets;
  await fs.writeFile('research/minecraft-city-candidates.json',JSON.stringify(manifest,null,2));
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2));
  console.log(JSON.stringify({category:installed.name,questions:installed.questions.map(({value,answer,slowReveal})=>({value,answer,slowReveal})),existingCategoriesPreserved:true,allMediaVerified:true},null,2));
}finally{socket.disconnect();}

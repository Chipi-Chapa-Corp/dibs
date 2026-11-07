import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',directory='research/brainrot';
const assets=JSON.parse(await fs.readFile(`${directory}/assets.json`,'utf8'));
assert.equal(assets.length,6);
assert(assets.every(a=>!a.error&&a.file),'All six images must be ready.');
const socket=io(base,{transports:['websocket'],reconnection:false});
let state;
socket.on('state',value=>{state=value;});
const emit=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(Error(result?.error||'Command failed'))));
const id=()=>randomUUID().replaceAll('-','').slice(0,12);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const mime={PNG:'image/png',JPEG:'image/jpeg',WEBP:'image/webp'};
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await emit('subscribe',{gameId,role:'host',editing:true});
  assert.equal(state?.status,'lobby','The game must be in the lobby.');
  assert.equal(state?.editLock,'mine','Another editor holds the editing lock.');
  const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);
  const before=await response.json(),rounds=structuredClone(before.rounds);
  assert.equal(rounds[1]?.type,'board','Round 2 must exist.');
  assert(!rounds.some(r=>r.categories.some(c=>['брейнрот','мозги гниют'].includes(c.name.toLowerCase()))),'Category already exists.');
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2));
  const category={id:id(),name:'Брейнрот',questions:[]};
  for(const [index,asset] of assets.entries()){
    assert.equal(asset.value,(index+1)*200);
    const bytes=await fs.readFile(asset.file);asset.sha256=hash(bytes);
    const type=mime[asset.format];assert(type);
    const extension={PNG:'png',JPEG:'jpg',WEBP:'webp'}[asset.format];
    const form=new FormData();form.append('file',new Blob([bytes],{type}),`character-${index+1}.${extension}`);
    const upload=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'X-Editor-Id':socket.id},body:form});
    const media=await upload.json();assert(upload.ok&&media.url,media.error||'Upload failed');asset.mediaUrl=media.url;
    const episode=asset.timestamp?`Персонаж использован в «Свояке»: https://www.youtube.com/watch?v=vvI8CgA-Wcw&t=${asset.timestamp}s`:'Дополнительный персонаж по просьбе пользователя; не отдельный вопрос в исходной категории «Свояка».';
    category.questions.push({id:id(),value:asset.value,prompt:`Как его зовут?\n\n![Персонаж](${media.url})`,answer:asset.answer,notes:`Засчитывать: ${asset.accepted}. Допускать близкое узнаваемое произношение.\nИсточник изображения: ${asset.source}\nИзображение: ${asset.url}\n${episode}`,dailyDouble:false,modifier:null,responseType:'free',slowReveal:true});
  }
  rounds[1].categories.push(category);
  await emit('command',{action:'save',data:{rounds}});
  const exported=await fetch(`${base}/api/games/${gameId}/export`);assert(exported.ok);
  const after=await exported.json();assert.deepEqual(after.rounds,rounds);
  const unchanged=structuredClone(after);unchanged.rounds[1].categories.pop();assert.deepEqual(unchanged,before);
  for(const asset of assets){const media=await fetch(base+asset.mediaUrl);assert(media.ok&&media.headers.get('content-type')?.startsWith(mime[asset.format]));assert.equal(hash(Buffer.from(await media.arrayBuffer())),asset.sha256);}
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2));
  await fs.writeFile(`${directory}/assets.json`,JSON.stringify(assets,null,2));
  console.log(JSON.stringify({game:after.name,round:2,category:category.name,questions:category.questions.map(({value,answer,slowReveal})=>({value,answer,slowReveal})),otherContentPreserved:true,imagesVerified:true}));
}finally{socket.disconnect();}

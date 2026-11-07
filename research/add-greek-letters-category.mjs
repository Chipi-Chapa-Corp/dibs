import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',directory='research/greek-letters';
const attachmentRoot='/var/folders/t3/wh0_r9jx0jz4kqxrwpsvv5rh0000gn/T';
const assets=[
  {source:'codex-clipboard-c5778baa-0af4-455b-ab41-72ad8a6b8e98.png',file:'alpha.png',value:200,answer:'Альфа',accepted:'альфа, alpha, α, Α',timestamp:581},
  {source:'codex-clipboard-f1c1d222-2faf-4e1c-aacd-6f897d45cd59.png',file:'kappa.png',value:400,answer:'Каппа',accepted:'каппа, капа, kappa, κ, Κ',timestamp:1297},
  {source:'codex-clipboard-a9f170f6-c1e3-449a-9e4e-a195f2924dc5.png',file:'sigma.png',value:600,answer:'Сигма',accepted:'сигма, sigma, σ, ς, Σ',timestamp:1187},
  {source:'codex-clipboard-f6e636ec-71e2-4e72-8082-dde807fbe134.png',file:'delta.png',value:800,answer:'Дельта',accepted:'дельта, delta, δ, Δ',timestamp:1034},
  {source:'codex-clipboard-23e6046f-264b-4053-9f62-624ef3722a3c.png',file:'gamma.png',value:1000,answer:'Гамма',accepted:'гамма, gamma, γ, Γ',timestamp:1069},
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
  assert.equal(state?.status,'lobby','The game must be in the lobby.');
  assert.equal(state?.editLock,'mine','Another editor holds the editing lock.');
  const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);
  const before=await response.json(),rounds=structuredClone(before.rounds);
  assert.equal(before.name,'Это моя игра');
  assert.equal(rounds[1]?.type,'board','Round 2 must exist.');
  assert(!rounds.some(r=>r.categories.some(c=>c.name.toLowerCase()==='греческие буквы')),'Category already exists.');
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n');
  const category={id:id(),name:'Греческие буквы',questions:[]};
  for(const [index,asset] of assets.entries()){
    assert.equal(asset.value,(index+1)*200);
    const bytes=await fs.readFile(`${attachmentRoot}/${asset.source}`);
    asset.sha256=hash(bytes);
    asset.file=`${directory}/${asset.file}`;
    await fs.writeFile(asset.file,bytes);
    const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),`greek-letter-${index+1}.png`);
    const upload=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'X-Editor-Id':socket.id},body:form});
    const media=await upload.json();assert(upload.ok&&media.url,media.error||'Upload failed');asset.mediaUrl=media.url;
    category.questions.push({id:id(),value:asset.value,prompt:`Какая греческая буква зашифрована на картинке?\n\n![Подсказка](${media.url})`,answer:asset.answer,notes:`Засчитывать: ${asset.accepted}.\nИсточник: https://www.youtube.com/watch?v=1mcvkh7FBPw&t=${asset.timestamp}s\nИзображение предоставлено пользователем и сохранено без изменений.\nИсходная стоимость: ${asset.value/2}.`,dailyDouble:false,modifier:null,responseType:'free',slowReveal:true});
  }
  rounds[1].categories.push(category);
  await emit('command',{action:'save',data:{rounds}});
  const exported=await fetch(`${base}/api/games/${gameId}/export`);assert(exported.ok);
  const after=await exported.json();assert.deepEqual(after.rounds,rounds);
  const unchanged=structuredClone(after);unchanged.rounds[1].categories.pop();assert.deepEqual(unchanged,before);
  for(const asset of assets){
    const media=await fetch(base+asset.mediaUrl);assert(media.ok&&media.headers.get('content-type')?.startsWith('image/png'));
    assert.equal(hash(Buffer.from(await media.arrayBuffer())),asset.sha256);
  }
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n');
  await fs.writeFile(`${directory}/assets.json`,JSON.stringify(assets,null,2)+'\n');
  console.log(JSON.stringify({game:after.name,round:2,category:category.name,questions:category.questions.map(({value,answer,slowReveal})=>({value,answer,slowReveal})),otherContentPreserved:true,imagesVerified:true}));
}finally{socket.disconnect();}

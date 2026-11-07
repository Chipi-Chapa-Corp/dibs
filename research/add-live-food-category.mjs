import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',directory='research/live-food';
const assets=JSON.parse(await fs.readFile(`${directory}/assets.json`,'utf8'));
const entries=[
  {answer:'Селёдка под шубой',accepted:'селёдка под шубой, сельдь под шубой, шуба',time:3460},
  {answer:'Макароны по-флотски',accepted:'макароны по-флотски, макароны по-флотскому',time:3320},
  {answer:'Мясо по-французски',accepted:'мясо по-французски',time:2433},
  {answer:'Ленивые голубцы',accepted:'ленивые голубцы',time:2979},
  {answer:'Докторская колбаса',accepted:'докторская колбаса, докторская',time:2770},
  {answer:'Цезарь с курицей',accepted:'цезарь с курицей, салат цезарь с курицей',time:2752},
  {answer:'Гречка по-купечески',accepted:'гречка по-купечески, купеческая гречка',time:2585},
];
assert.equal(assets.length,entries.length);
const id=()=>randomUUID().replaceAll('-','').slice(0,12);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
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
  assert(rounds.length>=2);
  assert(!rounds.some(r=>r.categories.some(c=>c.name.toLowerCase()==='живая еда')),'Category already exists.');
  const createdRound=rounds.length===2;
  if(createdRound)rounds.push({id:id(),name:'Round 3',type:'board',categories:[]});
  assert.equal(rounds[2].type,'board');
  assert(rounds[2].categories.length<10);
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n');
  const category={id:id(),name:'Живая еда',questions:[]};
  for(const [index,entry] of entries.entries()){
    const asset=assets[index],bytes=await fs.readFile(asset.file);
    asset.value=(index+1)*300;asset.answer=entry.answer;asset.sha256=hash(bytes);
    await fs.copyFile(asset.original,`${directory}/original-${index+1}.png`);
    const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),`live-food-${index+1}.png`);
    const upload=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'X-Editor-Id':socket.id},body:form});
    const media=await upload.json();assert(upload.ok&&media.url,media.error||'Upload failed');asset.mediaUrl=media.url;
    category.questions.push({id:id(),value:asset.value,prompt:`Какая еда зашифрована на картинке?\n\n![Загадка](${media.url})`,answer:entry.answer,
      notes:`Засчитывать: ${entry.accepted}.\nИсточник: «Свояк», Данила Горилла / Макс 100500 / Сатир, раунд 3.\nhttps://www.youtube.com/watch?v=tXEM3FSfsWc&t=${entry.time}s\nИзображение из скриншота пользователя восстановлено с помощью imagegen: удалена синяя рамка, улучшена чёткость. Максимальная сторона сохранённого изображения — 1080 пикселей.`,
      dailyDouble:false,modifier:null,responseType:'free',slowReveal:true});
  }
  rounds[2].categories.push(category);
  await emit('command',{action:'save',data:{rounds}});
  const exported=await fetch(`${base}/api/games/${gameId}/export`);assert(exported.ok);
  const after=await exported.json();assert.deepEqual(after.rounds,rounds);
  const unchanged=structuredClone(after);unchanged.rounds[2].categories.pop();if(createdRound)unchanged.rounds.pop();assert.deepEqual(unchanged,before);
  for(const asset of assets){const media=await fetch(base+asset.mediaUrl);assert(media.ok&&media.headers.get('content-type')?.startsWith('image/png'));assert.equal(hash(Buffer.from(await media.arrayBuffer())),asset.sha256);}
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n');
  await fs.writeFile(`${directory}/assets.json`,JSON.stringify(assets,null,2)+'\n');
  console.log(JSON.stringify({game:after.name,round:3,createdRound,category:category.name,questions:category.questions.map(({value,answer,slowReveal})=>({value,answer,slowReveal})),otherContentPreserved:true,imagesVerified:true}));
}finally{socket.disconnect();}

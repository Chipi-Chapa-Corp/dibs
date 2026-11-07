import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',directory='research/instruments';
const assets=JSON.parse(await fs.readFile(`${directory}/assets.json`,'utf8'));
assert.equal(assets.length,7);
assert.equal(new Set(assets.map(a=>a.answer)).size,7);
assert.equal(new Set(assets.map(a=>a.sha256)).size,7);
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
  assert.equal(rounds[2].type,'board');
  assert(rounds[2].categories.length<10);
  assert(!rounds.some(r=>r.categories.some(c=>c.name.toLowerCase()==='музыкальные инструменты')),'Category already exists.');
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n');
  const category={id:id(),name:'Музыкальные инструменты',questions:[]};
  for(const [index,asset] of assets.entries()){
    const bytes=await fs.readFile(asset.file);assert.equal(hash(bytes),asset.sha256);
    const form=new FormData();form.append('file',new Blob([bytes],{type:'audio/mpeg'}),`clip-${index+1}.mp3`);
    const upload=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'X-Editor-Id':socket.id},body:form});
    const media=await upload.json();assert(upload.ok&&media.url,media.error||'Upload failed');asset.mediaUrl=media.url;
    const credits=asset.sources.map(s=>`${s.title}\n${s.page}`).join('\n');
    category.questions.push({id:id(),value:asset.value,prompt:`Какой инструмент звучит?\n\n[Слушать](${media.url})`,answer:asset.answer,
      notes:`Засчитывать: ${asset.accepted}.\nЗапись: ${asset.author}.\nИсточник: Wikimedia Commons.\n${credits}\nЛицензия записи и этого аудиофрагмента: ${asset.license}${asset.licenseUrl?' — '+asset.licenseUrl:''}.\nИзменения: ${asset.changes}\nДлительность: ${asset.duration.toFixed(2)} с.`,
      dailyDouble:false,modifier:null,responseType:'free',slowReveal:false});
  }
  rounds[2].categories.push(category);
  await emit('command',{action:'save',data:{rounds}});
  const exported=await fetch(`${base}/api/games/${gameId}/export`);assert(exported.ok);
  const after=await exported.json();assert.deepEqual(after.rounds,rounds);
  const unchanged=structuredClone(after);unchanged.rounds[2].categories.pop();assert.deepEqual(unchanged,before);
  for(const asset of assets){
    const media=await fetch(base+asset.mediaUrl);assert(media.ok&&media.headers.get('content-type')?.startsWith('audio/mpeg'));
    assert.equal(hash(Buffer.from(await media.arrayBuffer())),asset.sha256);
    const range=await fetch(base+asset.mediaUrl,{headers:{Range:'bytes=0-1023'}});assert.equal(range.status,206);
    assert.equal((await range.arrayBuffer()).byteLength,1024);
  }
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n');
  await fs.writeFile(`${directory}/assets.json`,JSON.stringify(assets,null,2)+'\n');
  console.log(JSON.stringify({game:after.name,round:3,category:category.name,questions:category.questions.map(({value,answer})=>({value,answer})),otherContentPreserved:true,audioHashesAndRangePlaybackVerified:true}));
}finally{socket.disconnect();}

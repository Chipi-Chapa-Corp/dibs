import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',directory='research/instruments/replacements';
const replacements=JSON.parse(await fs.readFile(`${directory}/assets.json`,'utf8'));
assert.deepEqual(replacements.map(a=>a.answer),['Гитара','Пианино']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const socket=io(base,{transports:['websocket'],reconnection:false,timeout:10000});
let state;socket.on('state',value=>{state=value;});
const emit=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(Error(result?.error||'Command failed'))));
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await emit('subscribe',{gameId,role:'host',editing:true});
  assert.equal(state?.status,'lobby','The game must be in the lobby.');
  assert.equal(state?.editLock,'mine','Another editor holds the editing lock.');
  const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);
  const before=await response.json(),rounds=structuredClone(before.rounds);
  assert.equal(before.name,'Это моя игра');
  const category=rounds[2].categories.find(c=>c.name==='Музыкальные инструменты');assert(category);
  assert.equal(category.questions.length,7);
  const oldQuestions=structuredClone(category.questions);
  assert.deepEqual(new Set(oldQuestions.map(q=>q.answer)),new Set(['Скрипка','Саксофон','Флейта','Труба','Аккордеон','Губная гармошка','Волынка']));
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n');
  const newQuestions=[];
  for(const [index,asset] of replacements.entries()){
    const bytes=await fs.readFile(asset.file);assert.equal(hash(bytes),asset.sha256);
    const form=new FormData();form.append('file',new Blob([bytes],{type:'audio/mpeg'}),`clip-${index+1}.mp3`);
    const upload=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'X-Editor-Id':socket.id},body:form});
    const media=await upload.json();assert(upload.ok&&media.url,media.error||'Upload failed');asset.mediaUrl=media.url;
    const prior=oldQuestions.find(q=>q.answer===['Труба','Аккордеон'][index]);
    const credits=asset.sources.map(s=>`${s.title}\n${s.page}`).join('\n');
    newQuestions.push({...prior,value:(index+1)*300,prompt:`Какой инструмент звучит?\n\n[Слушать](${media.url})`,answer:asset.answer,
      notes:`Засчитывать: ${asset.accepted}.\nЗапись: ${asset.author}.\nИсточник: Wikimedia Commons.\n${credits}\nЛицензия записи и этого аудиофрагмента: ${asset.license} — ${asset.licenseUrl}.\nИзменения: ${asset.changes}\nДлительность: ${asset.duration.toFixed(2)} с.`});
  }
  const retained=['Скрипка','Саксофон','Флейта','Губная гармошка','Волынка'];
  for(const [index,answer] of retained.entries()){
    const question=category.questions.find(q=>q.answer===answer);assert(question);
    newQuestions.push({...question,value:(index+3)*300});
  }
  category.questions=newQuestions;
  await emit('command',{action:'save',data:{rounds}});
  const exported=await fetch(`${base}/api/games/${gameId}/export`);assert(exported.ok);
  const after=await exported.json();assert.deepEqual(after.rounds,rounds);
  const unchanged=structuredClone(after);unchanged.rounds[2].categories.find(c=>c.id===category.id).questions=oldQuestions;assert.deepEqual(unchanged,before);
  for(const asset of replacements){
    const media=await fetch(base+asset.mediaUrl);assert(media.ok&&media.headers.get('content-type')?.startsWith('audio/mpeg'));
    assert.equal(hash(Buffer.from(await media.arrayBuffer())),asset.sha256);
    const range=await fetch(base+asset.mediaUrl,{headers:{Range:'bytes=0-1023'}});assert.equal(range.status,206);await range.arrayBuffer();
  }
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n');
  await fs.writeFile(`${directory}/assets.json`,JSON.stringify(replacements,null,2)+'\n');
  const originalManifest=await fs.readFile('research/instruments/assets.json','utf8');
  await fs.writeFile(`${directory}/previous-assets.json`,originalManifest);
  const originals=JSON.parse(originalManifest);
  const active=[...replacements,...retained.map(answer=>originals.find(a=>a.answer===answer))].map((asset,index)=>({...asset,value:(index+1)*300}));
  await fs.writeFile('research/instruments/assets.json',JSON.stringify(active,null,2)+'\n');
  console.log(JSON.stringify({category:category.name,round:3,questions:newQuestions.map(({value,answer})=>({value,answer})),otherContentPreserved:true,audioVerified:true}));
}finally{socket.disconnect();}

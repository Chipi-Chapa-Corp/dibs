import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D';
const ranking=[['zhabaunti','жабаунти'],['krabrikos','крабрикос'],['krysalo','крысало'],['makakao','макакао'],['komarker','комаркер'],['pudelfin','пудельфин'],['dzhinitki','джинитки'],['zhemchugor','жемчугорь']];
const socket=io(base,{transports:['websocket'],reconnection:false});
let state;
socket.on('state',value=>{state=value;});
const command=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(new Error(result?.error||'Command failed'))));
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await command('subscribe',{gameId,role:'host',editing:true});
  if(state?.editLock!=='mine')throw new Error('The editor is still locked by another window.');
  const response=await fetch(`${base}/api/games/${gameId}/export`);
  if(!response.ok)throw new Error('Could not export game');
  const before=await response.json();
  await fs.writeFile('research/restored-images/game-before-shlakoblokun.json',JSON.stringify(before,null,2));
  const rounds=structuredClone(before.rounds),category=rounds[0].categories.find(c=>c.name==='Шлакоблокунь');
  if(!category)throw new Error('Category missing');
  const old=category.questions.find(q=>q.answer==='макакао');
  if(!old||category.questions.length!==1)throw new Error('Expected just the existing макакао; inspect before adding anything.');
  const manifest=JSON.parse(await fs.readFile('research/restored-images/shlakoblokun-assets.json','utf8'));
  const questions=[];
  for(const [index,[name,answer]] of ranking.entries()){
    if(name==='makakao'){questions.push({...old,value:(index+1)*100,slowReveal:true});continue;}
    const asset=manifest.find(a=>a.name===name);
    if(!asset)throw new Error(`Missing restored asset: ${name}`);
    const form=new FormData();
    form.append('file',new Blob([await fs.readFile(asset.path)],{type:'image/png'}),`${name}-restored.png`);
    const uploaded=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'x-editor-id':socket.id},body:form});
    const media=await uploaded.json();
    if(!uploaded.ok||!media.url)throw new Error(media.error||'Upload failed');
    asset.mediaUrl=media.url;
    questions.push({id:randomUUID().replaceAll('-','').slice(0,12),value:(index+1)*100,prompt:`![Ребус](${media.url})`,answer,notes:'',dailyDouble:false,modifier:null,responseType:'free',slowReveal:true});
  }
  category.questions=questions;
  await command('command',{action:'save',data:{rounds}});
  const after=await(await fetch(`${base}/api/games/${gameId}/export`)).json();
  const installed=after.rounds[0].categories.find(c=>c.id===category.id).questions;
  if(installed.length!==8||installed.some((q,i)=>q.answer!==ranking[i][1]||q.value!==(i+1)*100||q.slowReveal!==true))throw new Error('Saved category did not match');
  const preserved=installed.find(q=>q.id===old.id);
  if(preserved?.prompt!==old.prompt||preserved.answer!==old.answer)throw new Error('Existing макакао changed unexpectedly');
  for(const question of installed){
    const url=question.prompt.match(/\]\(([^)]+)\)/)?.[1];
    const image=await fetch(base+url);
    if(!image.ok||!image.headers.get('content-type')?.startsWith('image/'))throw new Error(`Broken image for ${question.answer}`);
  }
  await fs.writeFile('research/restored-images/shlakoblokun-assets.json',JSON.stringify(manifest,null,2));
  await fs.writeFile('research/restored-images/game-after-shlakoblokun.json',JSON.stringify(after,null,2));
  console.log(JSON.stringify(installed.map(({id,value,answer,slowReveal})=>({id,value,answer,slowReveal})),null,2));
}finally{socket.disconnect();}

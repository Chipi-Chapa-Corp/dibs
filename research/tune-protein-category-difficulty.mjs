import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {io} from 'socket.io-client';
const base='http://localhost:43187',gameId='95AF7D',dir='research/protein-lebowski/difficulty',categoryId='bd0f0c360fe7';
const prior=JSON.parse(await fs.readFile('research/protein-lebowski/installed.json','utf8'));
// Keep the introductory question; progressively narrow the comparisons using simple weighed portions.
const grams=[[100,200],[40,200],[100,250],[160,100],[500,50],[70,100]];
const n=x=>String(x).replace('.',','),round1=x=>Math.round((x+Number.EPSILON)*10)/10;
const entries=prior.entries.map((pair,i)=>pair.map((f,j)=>({...f,grams:grams[i][j],exactProtein:grams[i][j]*f.per100/100,protein:round1(grams[i][j]*f.per100/100)})));
const metrics=entries.map(([a,b],i)=>({value:(i+1)*300,left:a.protein,right:b.protein,exactGap:Math.abs(a.exactProtein-b.exactProtein),displayedGap:round1(Math.abs(a.protein-b.protein)),relativeGap:Math.abs(a.exactProtein-b.exactProtein)/Math.max(a.exactProtein,b.exactProtein)}));
assert.deepEqual(metrics.map(m=>[m.left,m.right]),[[12.5,24.4],[11.1,9],[8.9,8.3],[12.6,13.1],[16.5,16.9],[22.7,22.8]]);
for(const [i,m]of metrics.entries()){assert(m.displayedGap>0);if(i){assert(m.relativeGap<metrics[i-1].relativeGap,'Relative protein gaps must narrow');assert(m.displayedGap<metrics[i-1].displayedGap,'Displayed protein gaps must narrow');}}
assert(metrics[5].relativeGap<.01,'Final comparison should be within 1%');
const byKey=Object.fromEntries(prior.assets.map(a=>[a.key,a]));
const socket=io(base,{transports:['websocket'],reconnection:false,timeout:10000});let state;socket.on('state',s=>state=s);
const emit=(event,input)=>new Promise((res,rej)=>socket.timeout(10000).emit(event,input,(err,r)=>err?rej(err):r?.ok?res(r):rej(Error(r?.error||'Command failed'))));
try{
 await new Promise((res,rej)=>{socket.once('connect',res);socket.once('connect_error',rej)});
 await emit('subscribe',{gameId,role:'host',editing:true});assert.equal(state?.status,'lobby');assert.equal(state?.editLock,'mine');
 const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);const before=await response.json(),rounds=structuredClone(before.rounds),category=rounds[2].categories.find(c=>c.id===categoryId);assert.equal(category?.name,'Скам на массу');assert.equal(category.questions.length,6);assert.deepEqual(category,prior.category,'Inspect questions changed since the saved manifest');
 await fs.writeFile(`${dir}/game-before.json`,JSON.stringify(before,null,2)+'\n');await fs.writeFile(`${dir}/manifest-before.json`,JSON.stringify(prior,null,2)+'\n');
 category.questions=category.questions.map((q,i)=>{
  const[a,b]=entries[i],winner=a.exactProtein>b.exactProtein?a:b,side=winner===a?'Слева':'Справа';
  const photo=f=>`<img src="${byKey[f.key].mediaUrl}" alt="${f.label}" width="250" height="180">`;
  const label=f=>`**${f.label}**<br>**${f.grams} г**`;
  const prompt=`Где больше белка по справочным данным?\n\n| Слева | Справа |\n| :---: | :---: |\n| ${photo(a)} | ${photo(b)} |\n| ${label(a)} | ${label(b)} |\n\nСравниваем указанные порции.`;
  const answer=`**${side} — ${winner.label}: ≈ ${n(winner.protein)} г белка.**\n\nСлева: **≈ ${n(a.protein)} г** · Справа: **≈ ${n(b.protein)} г**.`;
  const explain=f=>`${f.label}: ${n(f.per100)} г белка на 100 г съедобной части.\n${f.grams} × ${n(f.per100)} / 100 = ${n(Number(f.exactProtein.toFixed(4)))} г; на экране ≈ ${n(f.protein)} г.\nИсточник: ${f.source}`;
  const credits=q.notes.split('\n\nФото:\n')[1];assert(credits,'Photo attribution missing');
  const notes=`Засчитывать: «${side.toLowerCase()}», название еды или очевидный разговорный вариант.\n\n${explain(a)}\n\n${explain(b)}\n\nРазница по исходным справочным значениям: ${n(Number(metrics[i].exactGap.toFixed(4)))} г (${n(round1(metrics[i].relativeGap*100))}% от большего значения). С ростом стоимости уменьшаются и абсолютная, и относительная разница.\n\nПравильный ответ определяется приведёнными справочными значениями для видов еды. Это особенно важно для почти равных сравнений: конкретные продукты и способы приготовления могут давать другие цифры. Округление до 0,1 г применяется после расчёта порции.\n\nСравниваем белок в указанных порциях. Фасоль и чечевица взвешены после варки, овсянка — сухой; яйца и курица — сырыми, яйца без скорлупы. Молоко взвешено в граммах. Фото иллюстративные, массу задаёт подпись.\n\nФото:\n${credits}`;
  return{...q,prompt,answer,notes};
 });
 await emit('command',{action:'save',data:{rounds}});
 const after=await(await fetch(`${base}/api/games/${gameId}/export`)).json();assert.deepEqual(after.rounds,rounds);
 const unchanged=structuredClone(after),oldCategory=before.rounds[2].categories.find(c=>c.id===categoryId);unchanged.rounds[2].categories[unchanged.rounds[2].categories.findIndex(c=>c.id===categoryId)]=oldCategory;assert.deepEqual(unchanged,before,'Unrelated content changed');
 for(let i=0;i<6;i++){const expected=structuredClone(oldCategory.questions[i]);expected.prompt=category.questions[i].prompt;expected.answer=category.questions[i].answer;expected.notes=category.questions[i].notes;assert.deepEqual(category.questions[i],expected,'Question settings changed');}
 const manifest={...prior,category,entries,difficulty:metrics};
 await fs.writeFile(`${dir}/game-after.json`,JSON.stringify(after,null,2)+'\n');await fs.writeFile(`${dir}/installed.json`,JSON.stringify(manifest,null,2)+'\n');await fs.writeFile('research/protein-lebowski/installed.json',JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({category:category.name,round:3,questions:entries.map(([a,b],i)=>({value:metrics[i].value,left:`${a.label}, ${a.grams} г → ${n(a.protein)} г белка`,right:`${b.label}, ${b.grams} г → ${n(b.protein)} г белка`,gap:metrics[i].displayedGap,relativeGapPercent:round1(metrics[i].relativeGap*100)})),strictlyIncreasingCloseness:true,otherContentPreserved:true},null,2));
}finally{socket.disconnect();}

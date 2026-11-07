import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {io} from 'socket.io-client';
const base='http://localhost:43187',gameId='95AF7D',dir='research/protein-lebowski/unbranded',categoryId='bd0f0c360fe7';
const old=JSON.parse(await fs.readFile('research/protein-lebowski/installed.json','utf8'));
const previousAssets=old.assets;
const newAssets=JSON.parse(await fs.readFile(`${dir}/new-assets.json`,'utf8')).filter(x=>x.key!=='cheese');
const food=(key,label,grams,per100,dbid)=>({key,label,grams,per100,protein:Math.round(grams*per100/10)/10,source:`https://www.nutridatabaze.cz/potraviny/?id=${dbid}`});
const entries=[
 [food('eggs','Куриные яйца, сырые, без скорлупы',100,12.5,78),food('quark','Мягкий обезжиренный творог',200,12.2,130)],
 [food('peanut-butter','Арахисовая паста',50,27.7,464),food('yogurt','Натуральный йогурт, 3,5%',200,4.5,126)],
 [food('beans','Белая фасоль, варёная',150,8.9,496),food('milk','Молоко, 1,5%',250,3.3,113)],
 [food('lentils','Чечевица, варёная',100,7.9,495),food('oats','Овсяные хлопья, сухие',100,13.1,188)],
 [food('milk','Молоко, 1,5%',500,3.3,113),food('seeds','Тыквенные семечки, очищенные',60,33.8,369)],
 [{key:'parmesan',label:'Пармезан',grams:100,per100:32.4,protein:32.4,source:'https://www.parmigianoreggiano.com/product-guide-nutritional-characteristics'},food('chicken','Куриная грудка без кожи, сырая',100,22.8,230)]
];
assert.deepEqual(entries.map(([a,b])=>[a.protein,b.protein]),[[12.5,24.4],[13.9,9],[13.4,8.3],[7.9,13.1],[16.5,20.3],[32.4,22.8]]);
// Preserve the source pages used to validate the generic food entries.
for(const f of new Map(entries.flat().map(f=>[f.key,f])).values()){
 const r=await fetch(f.source,{signal:AbortSignal.timeout(20000)});assert(r.ok,`Source unavailable: ${f.key}`);const html=await r.text();
 if(f.source.includes('nutridatabaze')){const row=[...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>m[1]).find(x=>x.includes('Bílkoviny celkové')&&!x.includes('NCF:'));assert(row,`Missing protein row: ${f.key}`);const cells=[...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1].replace(/<[^>]*>/g,'').trim());assert.equal(Number(cells[1]),f.per100,`Source protein differs: ${f.key}`);}
 await fs.writeFile(`${dir}/${f.key}-nutrition-source.html`,html);
}
const socket=io(base,{transports:['websocket'],reconnection:false,timeout:10000});let state;socket.on('state',s=>state=s);
const emit=(event,input)=>new Promise((res,rej)=>socket.timeout(10000).emit(event,input,(err,r)=>err?rej(err):r?.ok?res(r):rej(Error(r?.error||'Command failed'))));
const hash=b=>createHash('sha256').update(b).digest('hex');const n=v=>String(v).replace('.',',');
try{
 await new Promise((res,rej)=>{socket.once('connect',res);socket.once('connect_error',rej)});await emit('subscribe',{gameId,role:'host',editing:true});assert.equal(state?.editLock,'mine');assert.equal(state?.status,'lobby');
 const r=await fetch(`${base}/api/games/${gameId}/export`);assert(r.ok);const before=await r.json(),rounds=structuredClone(before.rounds),category=rounds[2].categories.find(c=>c.id===categoryId);assert(category);assert.equal(category.questions.length,6);
 await fs.writeFile(`${dir}/game-before.json`,JSON.stringify(before,null,2)+'\n');
 for(const asset of newAssets){const bytes=await fs.readFile(asset.path);asset.sha256=hash(bytes);const form=new FormData();form.append('file',new Blob([bytes],{type:asset.type}),asset.path.split('/').at(-1));const upload=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'X-Editor-Id':socket.id},body:form});const data=await upload.json();assert(upload.ok&&data.url,data.error||'Upload failed');asset.mediaUrl=data.url;}
 const byKey=Object.fromEntries([...previousAssets,...newAssets].map(a=>[a.key,a]));
 category.name='Скам на массу';
 category.questions=category.questions.map((q,index)=>{
  const[a,b]=entries[index],win=a.protein>b.protein?a:b,side=win===a?'Слева':'Справа';
  const photo=f=>`<img src="${byKey[f.key].mediaUrl}" alt="${f.label}" width="250" height="180">`;
  const label=f=>`**${f.label}**<br>**${f.grams} г**`;
  const prompt=`Где больше белка?\n\n| Слева | Справа |\n| :---: | :---: |\n| ${photo(a)} | ${photo(b)} |\n| ${label(a)} | ${label(b)} |\n\nСравниваем указанные порции.`;
  const answer=`**${side} — ${win.label}: ≈ ${n(win.protein)} г белка.**\n\nСлева: **≈ ${n(a.protein)} г** · Справа: **≈ ${n(b.protein)} г**.`;
  const explain=f=>`${f.label}: ${n(f.per100)} г белка на 100 г съедобной части. Порция ${f.grams} г → примерно ${n(f.protein)} г белка.\nИсточник: ${f.source}`;
  const credits=[a,b].map(f=>{const p=byKey[f.key];return`${f.label}: ${p.source}\nАвтор: ${p.credit||'см. источник'}; лицензия: ${p.license||'см. источник'}.`}).join('\n\n');
  return{...q,prompt,answer,notes:`Засчитывать: «${side.toLowerCase()}», название еды или его очевидный разговорный вариант.\n\n${explain(a)}\n\n${explain(b)}\n\nИспользованы справочные значения для видов еды, а не этикетки конкретных марок. Значения приблизительные и округлены до 0,1 г. Сравниваем общее количество белка в указанных порциях. Фасоль и чечевица взвешены после варки, овсянка — сухой; мясо и яйца — сырыми, яйца без скорлупы. Молоко также взвешено в граммах. Фото иллюстративные; количество на фото не задаёт массу порции.\nПроверка источников: 6 ноября 2026.\n\nФото:\n${credits}`};
 });
 const banned=/MILKO|Vilgain|Nutrend|Madeta|Alpro|Bonduelle|dmBio|McDonald|Big Mac|A\.W\.|Parmigiano Reggiano/i;
 for(const q of category.questions){assert(!banned.test(q.prompt+'\n'+q.answer));assert.equal((q.prompt.match(/<img /g)||[]).length,2);assert.equal(q.responseType,'free');assert(!q.prompt.includes('г белка'));}
 await emit('command',{action:'save',data:{rounds}});
 const after=await(await fetch(`${base}/api/games/${gameId}/export`)).json();assert.deepEqual(after.rounds,rounds);const unchanged=structuredClone(after),oldCategory=before.rounds[2].categories.find(c=>c.id===categoryId);unchanged.rounds[2].categories[unchanged.rounds[2].categories.findIndex(c=>c.id===categoryId)]=oldCategory;assert.deepEqual(unchanged,before,'Unrelated game content changed');assert.deepEqual(category.questions.map(q=>({id:q.id,value:q.value})),oldCategory.questions.map(q=>({id:q.id,value:q.value})));
 const usedAssets=[...new Map(entries.flat().map(f=>[f.key,byKey[f.key]])).values()];for(const asset of usedAssets){const check=await fetch(base+asset.mediaUrl);assert(check.ok&&check.headers.get('content-type')?.startsWith('image/'));const bytes=Buffer.from(await check.arrayBuffer());if(asset.sha256)assert.equal(hash(bytes),asset.sha256);}
 const manifest={gameId,round:3,category,entries,assets:usedAssets};await fs.writeFile(`${dir}/installed.json`,JSON.stringify(manifest,null,2)+'\n');await fs.writeFile(`${dir}/game-after.json`,JSON.stringify(after,null,2)+'\n');await fs.writeFile('research/protein-lebowski/installed.json',JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({name:category.name,round:3,questions:category.questions.map((q,i)=>({value:q.value,left:entries[i][0].label,right:entries[i][1].label,answer:q.answer})),genericSourcesVerified:true,allImagesVerified:true,questionIdsAndValuesPreserved:true,otherContentPreserved:true},null,2));
}finally{socket.disconnect();}

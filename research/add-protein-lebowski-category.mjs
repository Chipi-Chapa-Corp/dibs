import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';
const base='http://localhost:43187',gameId='95AF7D',dir='research/protein-lebowski',name='Где белок, Лебовски?';
const source={
 skyr:'https://www.polabske.cz/muj-skyr-bily/',
 'peanut-butter':'https://aktin.cz/vilgain-arasidove-maslo-bio',
 bar:'https://www.nutrend.cz/produkt/delicious-bar-919/50-g-vanilka-karamel-v-mlecne-cokolade-28x',
 quark:'https://www.madeta.cz/produkty/jihocesky-tvaroh-odtucneny-250_g',
 almond:'https://www.alpro.com/cz/ingredient/mandle',
 milk:'https://www.madeta.cz/produkty/jihoceske-mleko-cerstve-polotucne-1-5-1_l',
 parmesan:'https://www.parmigianoreggiano.com/product-guide-nutritional-characteristics',
 beans:'https://www.bonduelle.cz/zelenina/p/vapeur-cannellini/03083681003901',
 seeds:'https://www.dm.cz/p/d/1468881/dmbio-bio-dynova-seminka',
 tvaruzky:'https://www.tvaruzky.cz/vyrobky/ot-gastro/',
 bigmac:'https://www.mcdonalds.cz/menu/hovezi/big-mac/'
};
const food=(key,label,amount,per100,unit='г')=>({key,label,amount,per100,unit,protein:Math.round(amount*per100)/100});
const entries=[
 [food('skyr','Натуральный скир MILKO',130,12),food('peanut-butter','Арахисовая паста Vilgain BIO',30,25)],
 [food('bar','Один батончик Nutrend Delicious, ваниль и карамель',50,30),food('quark','Обезжиренный творог Madeta',250,11)],
 [food('almond','Миндальный напиток Alpro',1000,.4,'мл'),food('milk','Молоко Madeta 1,5%',250,3.2,'мл')],
 [food('parmesan','Пармезан Parmigiano Reggiano',50,32.4),food('beans','Белая фасоль Bonduelle Vapeur Cannellini, без жидкости',200,6.6)],
 [food('milk','Молоко Madeta 1,5%',500,3.2,'мл'),food('seeds','Очищенные тыквенные семечки dmBio',50,37)],
 [food('tvaruzky','Оломоуцкие тваружки A.W.',100,28),{key:'bigmac',label:'Один целый Big Mac из чешского McDonald’s',portion:'1 бургер',protein:24.7}]
];
const n=x=>String(x).replace('.',','),portion=f=>f.portion??`${f.amount} ${f.unit}`;
assert.deepEqual(entries.map(([a,b])=>[a.protein,b.protein]),[[15.6,7.5],[15,27.5],[4,8],[16.2,13.2],[16,18.5],[28,24.7]]);
const assets=JSON.parse(await fs.readFile(`${dir}/assets.json`,'utf8'));
const socket=io(base,{transports:['websocket'],reconnection:false,timeout:10000});
let state;socket.on('state',s=>state=s);
const emit=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(e,r)=>e?reject(e):r?.ok?resolve(r):reject(Error(r?.error||'Command failed'))));
const hash=b=>createHash('sha256').update(b).digest('hex');
const id=()=>randomUUID().replaceAll('-','').slice(0,12);
try{
 await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
 await emit('subscribe',{gameId,role:'host',editing:true});
 assert.equal(state?.status,'lobby','Game must be in the lobby');assert.equal(state?.editLock,'mine','Another editor has the lock');
 const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);const before=await response.json();
 assert.equal(before.name,'Это моя игра');assert.equal(before.rounds[2]?.type,'board');assert(before.rounds[2].categories.length<10);
 assert(!before.rounds.some(r=>r.categories.some(c=>c.name===name)),'Category already exists');
 await fs.writeFile(`${dir}/game-before.json`,JSON.stringify(before,null,2)+'\n');
 for(const [index,asset]of assets.entries()){
  if(index===10){console.log('Ten illustrations uploaded; waiting for the media upload rate window.');await new Promise(resolve=>setTimeout(resolve,61000));}
  const bytes=await fs.readFile(asset.path);asset.sha256=hash(bytes);const form=new FormData();form.append('file',new Blob([bytes],{type:asset.type}),asset.path.split('/').at(-1));
  const r=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'X-Editor-Id':socket.id},body:form});const media=await r.json();assert(r.ok&&media.url,media.error||'Upload failed');asset.mediaUrl=media.url;
 }
 const byKey=Object.fromEntries(assets.map(a=>[a.key,a]));
 const questions=entries.map(([a,b],index)=>{
  const winner=a.protein>b.protein?a:b,side=winner===a?'Слева':'Справа';
  const photo=f=>`<img src="${byKey[f.key].mediaUrl}" alt="${f.label}" width="250" height="180">`;
  const caption=f=>`**${f.label}**<br>**${portion(f)}**`;
  const prompt=`Где больше белка?\n\n| Слева | Справа |\n| :---: | :---: |\n| ${photo(a)} | ${photo(b)} |\n| ${caption(a)} | ${caption(b)} |\n\nСравниваем указанные порции.`;
  const answer=`**${side} — ${winner.label}: ${n(winner.protein)} г белка.**\n\nСлева: **${n(a.protein)} г** · Справа: **${n(b.protein)} г**.`;
  const explain=f=>`${f.label}, ${portion(f)}: ${n(f.protein)} г белка. ${f.per100===undefined?'Данные на один бургер.':`${n(f.per100)} г на 100 ${f.unit}; ${f.amount} × ${f.per100} / 100 = ${f.protein}.`}\nИсточник: ${source[f.key]}`;
  const credits=[a,b].map(f=>{const x=byKey[f.key];return `${f.label}: ${x.source}\nАвтор: ${x.credit||'см. источник'}; лицензия: ${x.license||'см. источник'}.`;}).join('\n\n');
  return{id:id(),value:(index+1)*300,prompt,answer,responseType:'free',notes:`Засчитывать: «${side.toLowerCase()}», название продукта или его очевидный разговорный вариант.\n\n${explain(a)}\n\n${explain(b)}\n\nСравнивается общее количество белка в подписанных порциях, по опубликованным данным выбранных продуктов. Фото иллюстративные: размер и число объектов на фото не задают порцию.\nПроверка источников: 6 ноября 2026.\n\nФото:\n${credits}`,dailyDouble:false,modifier:null,slowReveal:false};
 });
 const category={id:id(),name,questions},rounds=structuredClone(before.rounds);rounds[2].categories.push(category);
 await emit('command',{action:'save',data:{rounds}});
 const saved=await fetch(`${base}/api/games/${gameId}/export`);assert(saved.ok);const after=await saved.json();assert.deepEqual(after.rounds,rounds);
 const unchanged=structuredClone(after);unchanged.rounds[2].categories.pop();assert.deepEqual(unchanged,before,'Existing game content changed');
 for(const asset of assets){let r=await fetch(base+asset.mediaUrl);assert(r.ok&&r.headers.get('content-type')?.startsWith('image/'));assert.equal(hash(Buffer.from(await r.arrayBuffer())),asset.sha256);}
 await fs.writeFile(`${dir}/game-after.json`,JSON.stringify(after,null,2)+'\n');await fs.writeFile(`${dir}/installed.json`,JSON.stringify({gameId,round:3,category,entries,assets},null,2)+'\n');
 console.log(JSON.stringify({game:after.name,round:3,category:name,questions:questions.map(q=>({value:q.value,answer:q.answer})),allMediaVerified:true,existingContentPreserved:true},null,2));
}finally{socket.disconnect();}

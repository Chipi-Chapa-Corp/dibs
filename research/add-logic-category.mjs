import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D',directory='research/logic';
const original='/var/folders/t3/wh0_r9jx0jz4kqxrwpsvv5rh0000gn/T/codex-clipboard-9da58580-bf3a-4edd-9ec7-6b46467a9fbb.png';
const source=time=>`Источник: «Свояк», Даня Кашин / Yanix / Сатир, раунд 1. https://www.youtube.com/watch?v=S_RgvOA7CpE&t=${time}s`;
const entries=[
  {value:300,prompt:'Электровоз едет на север, ветер дует на запад. Куда летит дым?',answer:'Дыма нет',notes:'Электровоз работает на электричестве и не выпускает дым. Засчитывать: «никуда», если игрок поясняет, что дыма нет.'},
  {value:600,prompt:'Перед финишем вы обгоняете бегуна, занимающего вторую позицию. Каким финишируете?',answer:'Вторым',notes:`Вы занимаете место обогнанного бегуна — второе. Засчитывать: «вторым», «на втором месте», «2».\n${source(882)}`},
  {value:900,prompt:'Кувшинки каждый день удваивают покрытую ими площадь. За 30 дней они закрыли весь пруд. На какой день была закрыта половина?',answer:'На 29-й день',notes:'За день до полного покрытия площадь была вдвое меньше. Засчитывать: «29», «двадцать девятый день».'},
  {value:1200,prompt:'Кирпич весит один килограмм плюс половину собственного веса. Сколько весит кирпич?',answer:'2 килограмма',notes:'Половина кирпича весит 1 кг, поэтому целый — 2 кг. Уравнение: x = 1 + x/2. Засчитывать: «2 кг», «два килограмма».'},
  {value:1500,prompt:'Сколько девяток получится, если выписать все числа от 1 до 100?',answer:'20',notes:`Считаются отдельные цифры, а не числа: 10 девяток в разряде единиц и 10 в разряде десятков. В числе 99 две девятки. Засчитывать: «20», «двадцать».\n${source(251)}`},
  {value:1800,prompt:'Какой номер парковочного места закрывает машина на картинке?',answer:'87',image:true,notes:`Если перевернуть картинку на 180°, места идут по порядку: 86, 87, 88, 89, 90, 91. Машина закрывает 87. Засчитывать: «87», «восемьдесят семь».\n${source(1522)}\nСкриншот предоставлен пользователем; сохранён без изменений (1910 × 816). Изображение показывается целиком, чтобы все номера были видны одновременно.`},
  {value:2100,prompt:'Десять монахов раскрывают мешок, ещё пятеро забираются в него. Что зашифровано?',answer:'Носок',notes:`Десять пальцев рук растягивают носок, а пять пальцев ноги входят внутрь. Также засчитывать «перчатка»: эта формулировка допускает тот же ответ с пятью пальцами руки.\n${source(1278)}`},
];
assert.equal(entries.length,7);
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
  assert.equal(rounds[2]?.type,'board');
  assert(rounds[2].categories.length<10);
  assert(!rounds.some(r=>r.categories.some(c=>c.name.toLowerCase()==='логика')),'Category already exists.');
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n');
  const bytes=await fs.readFile(original);
  await fs.writeFile(`${directory}/parking-original.png`,bytes);
  const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),'logic-parking.png');
  const upload=await fetch(`${base}/api/games/${gameId}/media`,{method:'POST',headers:{'X-Editor-Id':socket.id},body:form});
  const media=await upload.json();assert(upload.ok&&media.url,media.error||'Upload failed');
  const served=await fetch(base+media.url);assert(served.ok&&served.headers.get('content-type')?.startsWith('image/png'));
  assert.equal(hash(Buffer.from(await served.arrayBuffer())),hash(bytes));
  const category={id:id(),name:'Логика',questions:entries.map(entry=>({
    id:id(),value:entry.value,prompt:entry.prompt+(entry.image?`\n\n![Парковочные места](${media.url})`:''),answer:entry.answer,notes:entry.notes,
    dailyDouble:false,modifier:null,responseType:'free',slowReveal:false,
  }))};
  rounds[2].categories.push(category);
  await emit('command',{action:'save',data:{rounds}});
  const exported=await fetch(`${base}/api/games/${gameId}/export`);assert(exported.ok);
  const after=await exported.json();assert.deepEqual(after.rounds,rounds);
  const unchanged=structuredClone(after);unchanged.rounds[2].categories.pop();assert.deepEqual(unchanged,before);
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n');
  await fs.writeFile(`${directory}/assets.json`,JSON.stringify([{original,file:`${directory}/parking-original.png`,mediaUrl:media.url,sha256:hash(bytes),width:1910,height:816}],null,2)+'\n');
  console.log(JSON.stringify({game:after.name,round:3,category:category.name,questions:category.questions.map(({value,answer})=>({value,answer})),otherContentPreserved:true,imageVerified:true}));
}finally{socket.disconnect();}

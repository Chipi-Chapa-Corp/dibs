import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D';
const directory=`research/modifier-insertion-${gameId}-${new Date().toISOString().replaceAll(':','-')}`;
const socket=io(base,{transports:['websocket'],reconnection:false});
let state;
socket.on('state',value=>{state=value;});
const emit=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(new Error(result?.error||'Command failed'))));
const exported=async()=>{const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);return response.json();};
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await emit('subscribe',{gameId,role:'host',editing:true});
  assert.equal(state?.editLock,'mine','Another editor is open; no game changes made.');
  assert.equal(state.status,'lobby','Game must still be in preparation.');
  const before=await exported();
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n',{mode:0o600});
  const rounds=structuredClone(before.rounds),round=rounds[0];
  assert.equal(round.type,'board');
  const cinema=round.categories.filter(c=>c.name.toLocaleLowerCase('ru')==='кинопейнт');
  const gym=round.categories.filter(c=>c.questions.some(q=>q.prompt.startsWith('Что он тренит?')));
  assert.equal(cinema.length,1,'Expected exactly one Кинопейнт category.');
  assert.equal(gym.length,1,'Expected exactly one Что он тренит? category.');
  const insertions=[
    {category:cinema[0],value:300,title:'Поменяйся баллами',instructions:'Поменяйся всеми баллами с любой другой командой на твой выбор. Обмен происходит сразу, включая отрицательные значения.'},
    {category:gym[0],value:500,title:'Умножь баллы на 0,5',instructions:'Умножь свой текущий счёт на 0,5. Эффект применяется сразу ко всему счёту, включая отрицательные значения.'}
  ];
  const moves=[];
  for(const insertion of insertions){
    const {category,value,title,instructions}=insertion;
    assert(category.questions.length<12,'Category would exceed the question limit.');
    assert(category.questions.some(q=>q.value===value),'Expected an existing question at the insertion value.');
    assert(!category.questions.some(q=>q.modifier?.title===title),'Modifier already exists.');
    assert.deepEqual(category.questions.map(q=>q.value),category.questions.map(q=>q.value).sort((a,b)=>a-b),'Expected ascending question values.');
    for(const q of category.questions)if(q.value>=value){moves.push({id:q.id,category:category.name,from:q.value,to:q.value+100});q.value+=100;}
    const q={id:randomUUID().replaceAll('-','').slice(0,12),value,prompt:'',answer:'',notes:'',dailyDouble:false,modifier:{title,instructions},responseType:'free',slowReveal:false};
    const index=category.questions.findIndex(q=>q.value>value);
    category.questions.splice(index<0?category.questions.length:index,0,q);
    insertion.id=q.id;
    assert.equal(new Set(category.questions.map(q=>q.value)).size,category.questions.length,'Duplicate question values.');
  }
  const originals=before.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions));
  const validate=after=>{
    assert.deepEqual(after.rounds,rounds,'Saved board differs from intended insertion.');
    const questions=after.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions));
    assert.equal(questions.length,originals.length+2);
    for(const original of originals){
      const saved=questions.find(q=>q.id===original.id);
      assert(saved,`Original question missing: ${original.id}`);
      assert.deepEqual({...saved,value:original.value},original,`Original question content changed: ${original.id}`);
    }
    for(const field of ['format','name','subtitle','settings','theme'])assert.deepEqual(after[field],before[field]);
    const touched=new Set(insertions.map(x=>x.category.id));
    assert.deepEqual(after.rounds[0].categories.filter(c=>!touched.has(c.id)),before.rounds[0].categories.filter(c=>!touched.has(c.id)));
    assert.deepEqual(after.rounds.slice(1),before.rounds.slice(1));
  };
  validate({...before,rounds});
  assert.deepEqual(await exported(),before,'Game changed while preparing; no save performed.');
  await emit('command',{action:'save',data:{rounds}});
  const after=await exported();validate(after);
  const publicView=await(await fetch(`${base}/api/games/${gameId}`)).json();
  for(const insertion of insertions){
    const publicQuestion=publicView.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions)).find(q=>q.id===insertion.id);
    assert.equal(publicQuestion.modifier,null,'Modifier should stay hidden on the public board.');
    assert(publicView.filledQuestionIds.includes(insertion.id),'Modifier must be selectable.');
  }
  const manifest={gameId,insertions:insertions.map(x=>({category:x.category.name,value:x.value,title:x.title,id:x.id})),moves,originalQuestionsPreserved:originals.length,totalQuestions:originals.length+2};
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n',{mode:0o600});
  await fs.writeFile(`${directory}/manifest.json`,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({...manifest,backup:directory},null,2));
}finally{socket.disconnect();}

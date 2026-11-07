import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {io} from 'socket.io-client';

const base='http://localhost:43187',gameId='95AF7D';
const directory=`research/round-three-modifiers-${gameId}-${new Date().toISOString().replaceAll(':','-')}`;
const socket=io(base,{transports:['websocket'],reconnection:false,timeout:10000});
let state;
socket.on('state',value=>{state=value;});
const emit=(event,input)=>new Promise((resolve,reject)=>socket.timeout(10000).emit(event,input,(error,result)=>error?reject(error):result?.ok?resolve(result):reject(new Error(result?.error||'Command failed'))));
const exported=async()=>{const response=await fetch(`${base}/api/games/${gameId}/export`);assert(response.ok);return response.json();};
try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  await emit('subscribe',{gameId,role:'host',editing:true});
  assert.equal(state?.editLock,'mine','Another editor holds the lock; no changes made.');
  assert.equal(state.status,'lobby','Game must be in preparation.');
  const before=await exported(),rounds=structuredClone(before.rounds),round=rounds[2];
  assert.equal(round.type,'board');
  const specifications=[
    {categoryName:'График или горы',title:'Заначка',instructions:'Получи 600 баллов. Прибавь их к своему текущему счёту сразу после получения модификатора.'},
    {categoryName:'Логика',title:'Штраф',instructions:'Потеряй 600 баллов. Вычти их из своего текущего счёта сразу после получения модификатора, даже если счёт станет отрицательным.'}
  ];
  const moves=[],insertions=[];
  for(const spec of specifications){
    const matches=round.categories.filter(c=>c.name===spec.categoryName);
    assert.equal(matches.length,1,`Expected one ${spec.categoryName} category.`);
    const category=matches[0];
    assert(category.questions.length>0&&category.questions.length<12,'Category must have space.');
    assert(!rounds.some(r=>r.categories.some(c=>c.questions.some(q=>q.modifier?.title===spec.title))),'Modifier already exists.');
    assert.deepEqual(category.questions.map(q=>q.value),category.questions.map((_,i)=>(i+1)*300),'Expected standard round-three values.');
    // Choose uniformly among insertion positions, including before and after existing questions.
    const index=randomInt(category.questions.length+1),value=(index+1)*300;
    for(const q of category.questions.slice(index)){
      moves.push({id:q.id,category:category.name,from:q.value,to:q.value+300});q.value+=300;
    }
    const question={id:randomUUID().replaceAll('-','').slice(0,12),value,prompt:'',answer:'',notes:'',dailyDouble:false,modifier:{title:spec.title,instructions:spec.instructions},responseType:'free',slowReveal:false};
    category.questions.splice(index,0,question);
    insertions.push({category:category.name,categoryId:category.id,value,title:spec.title,id:question.id});
  }
  const originals=before.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions));
  const validate=after=>{
    assert.deepEqual(after,{...before,rounds},'Saved definition differs from requested changes.');
    const questions=after.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions));
    assert.equal(questions.length,originals.length+2);
    assert.equal(new Set(questions.map(q=>q.id)).size,questions.length);
    for(const original of originals){
      const saved=questions.find(q=>q.id===original.id);
      assert(saved,`Original question missing: ${original.id}`);
      assert.deepEqual({...saved,value:original.value},original,`Original content changed: ${original.id}`);
    }
    for(let i=0;i<rounds.length;i++){
      if(i!==2)assert.deepEqual(after.rounds[i],before.rounds[i]);
      else for(const category of after.rounds[i].categories){
        const old=before.rounds[i].categories.find(c=>c.id===category.id);
        if(!insertions.some(x=>x.categoryId===category.id))assert.deepEqual(category,old);
        else assert.deepEqual(category.questions.filter(q=>old.questions.some(o=>o.id===q.id)).map(q=>q.id),old.questions.map(q=>q.id),'Original order changed.');
      }
    }
  };
  validate({...before,rounds});
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n',{mode:0o600});
  assert.deepEqual(await exported(),before,'Game changed during preparation; no save performed.');
  await emit('command',{action:'save',data:{rounds}});
  const after=await exported();validate(after);
  const publicView=await(await fetch(`${base}/api/games/${gameId}`)).json();
  for(const insertion of insertions){
    const publicQuestion=publicView.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions)).find(q=>q.id===insertion.id);
    assert.equal(publicQuestion.modifier,null);
    assert(publicView.filledQuestionIds.includes(insertion.id));
  }
  await new Promise(resolve=>setTimeout(resolve,600));
  const persisted=JSON.parse(await fs.readFile(`data/games/${gameId}.json`,'utf8'));
  assert.deepEqual(persisted.rounds,rounds,'Disk persistence differs.');
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n',{mode:0o600});
  const manifest={gameId,scoreChangeMagnitude:600,insertions,moves,originalQuestionsPreserved:originals.length,totalQuestions:originals.length+2,backup:directory};
  await fs.writeFile(`${directory}/manifest.json`,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(manifest,null,2));
}finally{socket.disconnect();}

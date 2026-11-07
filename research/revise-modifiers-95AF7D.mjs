import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {io} from 'socket.io-client';

const gameId='95AF7D',base='http://localhost:43187';
const directory=`research/modifier-revision-${gameId}-${new Date().toISOString().replaceAll(':','-')}`;
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
  const before=await exported(),rounds=structuredClone(before.rounds);
  const find=title=>{
    const matches=rounds.flatMap((round,roundIndex)=>round.categories.flatMap(category=>category.questions.flatMap((question,index)=>question.modifier?.title===title?[{roundIndex,category,question,index}]:[])));
    assert.equal(matches.length,1,`Expected exactly one ${title}.`);
    return matches[0];
  };
  const sponsor=find('Спонсор камбэка'),stash=find('Заначка'),penalty=find('Штраф');
  assert.equal(sponsor.roundIndex,1);assert.equal(sponsor.category.name,'Брейнрот');
  assert.equal(stash.roundIndex,2);assert.equal(stash.category.name,'График или горы');
  assert.equal(penalty.roundIndex,2);assert.equal(penalty.category.name,'Логика');
  for(const item of [sponsor,stash,penalty]){
    assert.equal(item.question.prompt,'');assert.equal(item.question.answer,'');assert.equal(item.question.notes,'');
    assert.deepEqual(item.category.questions.map(q=>q.value),item.category.questions.map((_,i)=>(i+1)*(item.roundIndex+1)*100));
  }
  // Exchange the two whole modifier questions, retaining each slot's board value.
  const stashValue=stash.question.value,penaltyValue=penalty.question.value;
  stash.category.questions[stash.index]={...penalty.question,value:stashValue};
  penalty.category.questions[penalty.index]={...stash.question,value:penaltyValue};
  const moves=[];
  const remove=(category,id,step)=>{
    const index=category.questions.findIndex(q=>q.id===id);assert(index>=0);
    category.questions.splice(index,1);
    for(const question of category.questions.slice(index)){
      moves.push({id:question.id,category:category.name,from:question.value,to:question.value-step});question.value-=step;
    }
  };
  remove(sponsor.category,sponsor.question.id,200);
  remove(penalty.category,stash.question.id,300);
  const originals=before.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions));
  const removedIds=new Set([sponsor.question.id,stash.question.id]);
  const validate=after=>{
    assert.deepEqual(after,{...before,rounds});
    const questions=after.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions));
    assert.equal(questions.length,originals.length-2);
    assert.equal(new Set(questions.map(q=>q.id)).size,questions.length);
    for(const original of originals){
      const saved=questions.find(q=>q.id===original.id);
      if(removedIds.has(original.id)){assert.equal(saved,undefined);continue;}
      assert(saved,`Original question missing: ${original.id}`);
      assert.deepEqual({...saved,value:original.value},original,`Content changed: ${original.id}`);
    }
    const moved=after.rounds[2].categories.find(c=>c.id===stash.category.id).questions.find(q=>q.id===penalty.question.id);
    assert.equal(moved.value,stashValue);assert.equal(moved.modifier.title,'Штраф');
    const touched=new Set([sponsor.category.id,stash.category.id,penalty.category.id]);
    for(let i=0;i<rounds.length;i++)for(const category of after.rounds[i].categories){
      const old=before.rounds[i].categories.find(c=>c.id===category.id);
      if(!touched.has(category.id))assert.deepEqual(category,old);
      // Regular questions retain their original order and their original category.
      assert.deepEqual(category.questions.filter(q=>!q.modifier).map(q=>q.id),old.questions.filter(q=>!q.modifier).map(q=>q.id));
      assert.deepEqual(category.questions.map(q=>q.value),category.questions.map((_,j)=>(j+1)*(i+1)*100));
    }
  };
  validate({...before,rounds});
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(`${directory}/game-before.json`,JSON.stringify(before,null,2)+'\n',{mode:0o600});
  assert.deepEqual(await exported(),before,'Game changed during preparation; no save performed.');
  await emit('command',{action:'save',data:{rounds}});
  const after=await exported();validate(after);
  await new Promise(resolve=>setTimeout(resolve,600));
  const persisted=JSON.parse(await fs.readFile(`data/games/${gameId}.json`,'utf8'));
  assert.deepEqual(persisted.rounds,rounds);
  const manifest={gameId,removed:['Спонсор камбэка','Заначка'],remainingPenalty:{category:stash.category.name,value:stashValue,modifier:penalty.question.modifier},moves,regularQuestionsPreserved:originals.filter(q=>!q.modifier).length,totalQuestions:originals.length-2,backup:directory};
  await fs.writeFile(`${directory}/game-after.json`,JSON.stringify(after,null,2)+'\n',{mode:0o600});
  await fs.writeFile(`${directory}/manifest.json`,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(manifest,null,2));
}finally{socket.disconnect();}

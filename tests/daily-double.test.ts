import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {act,addPlayer,createGame,view} from '../server/engine.ts';
import {openGameStore} from '../server/storage.ts';
import {demoRounds} from '../shared/model.ts';

function fixture(){
  const g=createGame({definition:{rounds:demoRounds()}}),a=addPlayer(g,'Selecting team'),b=addPlayer(g,'Opposing team'),other=addPlayer(g,'Other team');
  const q=g.rounds[0].categories[0].questions[0];q.dailyDouble=true;act(g,'start');act(g,'openQuestion',{questionId:q.id});
  return{g,a,b,other,q};
}

test('Daily Double requires a distinct opposing team and a chosen wager before revealing the clue',()=>{
  const{g,a,b,other,q}=fixture();
  assert.equal(g.current?.phase,'wager');assert.equal(g.current?.answeringId,null);
  assert.throws(()=>act(g,'assignDailyDouble',{fromId:a.id,playerId:a.id}),/different team/);
  assert.throws(()=>act(g,'assignDailyDouble',{fromId:'missing',playerId:b.id}),/Choose/);
  assert.throws(()=>act(g,'hostWager',{playerId:b.id,wager:500}),/assigned team/);
  assert.throws(()=>act(g,'finalBegin'),/Assign another team/);
  assert.throws(()=>act(g,'reveal'),/lock the wager/);
  act(g,'assignDailyDouble',{fromId:a.id,playerId:b.id});
  assert.equal(g.current?.dailyDoubleFromId,a.id);assert.equal(g.current?.answeringId,b.id);
  for(const player of [a,other])assert.throws(()=>act(g,'wager',{wager:500},'player',player.id),/assigned team/);
  assert.throws(()=>act(g,'assignDailyDouble',{fromId:a.id,playerId:other.id},'player',b.id),/Host access/);
  assert.throws(()=>act(g,'hostWager',{playerId:other.id,wager:500}),/assigned team/);
  assert.throws(()=>act(g,'finalBegin'),/collect/);
  // Host offers any point amounts aloud, independent of score and Final wager limits.
  for(const bad of [-1,NaN,Infinity,1.5,10000001])assert.throws(()=>act(g,'wager',{wager:bad},'player',b.id),/Enter a wager/);
  act(g,'wager',{wager:750},'player',b.id);
  assert.equal(b.score,0);assert.equal(g.current?.wagers[b.id].wager,750);
  assert.equal(view(g,'stage').current?.wagers[b.id].wager,750);
  assert.equal(view(g,'player',b.id).yourFinal?.wager,750);
  for(const role of ['stage','player']as const){const snapshot=view(g,role,b.id);assert.equal(snapshot.currentQuestion?.prompt,'');assert.equal(snapshot.currentQuestion?.answer,'');}
  assert.throws(()=>act(g,'wager',{wager:900},'player',b.id),/already submitted/);
  act(g,'hostWager',{playerId:b.id,wager:900});act(g,'finalBegin');
  assert.equal(g.current?.phase,'question');assert.equal(g.current?.buzzOpen,false);assert.equal(view(g,'stage').currentQuestion?.prompt,q.prompt);
});

test('only the assigned team is judged; wrong answers lose the wager without a buzzer race',()=>{
  for(const correct of [true,false]){
    const{g,a,b,other}=fixture();g.settings.autoOpenBuzzers=true;g.settings.deductWrong=false;
    act(g,'assignDailyDouble',{fromId:a.id,playerId:b.id});act(g,'wager',{wager:750},'player',b.id);act(g,'finalBegin');
    for(const action of ['openBuzzers','resetBuzzers','answerer'])assert.throws(()=>act(g,action,{playerId:other.id}),/required answerer/);
    for(const player of [a,b,other])assert.throws(()=>act(g,'buzz',{},'player',player.id),/assigned team/);
    assert.throws(()=>act(g,'judge',{playerId:other.id,correct}),/assigned team/);
    assert.throws(()=>act(g,'assignDailyDouble',{fromId:a.id,playerId:other.id}),/awaiting assignment/);
    assert.throws(()=>act(g,'removePlayer',{playerId:b.id}),/Finish the Daily Double/);
    act(g,'judge',{correct});assert.equal(g.players.find(p=>p.id===b.id)?.score,correct?750:-750);assert.equal(a.score,0);assert.equal(other.score,0);
    assert(g.current?.closed);assert(!g.current?.buzzOpen);assert.throws(()=>act(g,'judge',{correct}),/No active question/);
    act(g,'undo');assert.equal(g.players.find(p=>p.id===b.id)?.score,0);assert(!g.current?.closed);assert.equal(g.current?.answeringId,b.id);assert.equal(g.current?.wagers[b.id].wager,750);
  }
});

test('reassignment clears the previous choice; undo and restart preserve the forced assignment and stake',()=>{
  const{g,a,b,other}=fixture();act(g,'assignDailyDouble',{fromId:a.id,playerId:b.id});act(g,'hostWager',{playerId:b.id,wager:500});
  act(g,'assignDailyDouble',{fromId:a.id,playerId:other.id});assert.deepEqual(g.current?.wagers,{});
  assert.throws(()=>act(g,'wager',{wager:500},'player',b.id),/assigned team/);
  act(g,'undo');assert.equal(g.current?.answeringId,b.id);assert.equal(g.current?.wagers[b.id].wager,500);
  const dir=mkdtempSync(join(tmpdir(),'dibs-daily-double-'));
  try{
    const store=openGameStore(dir);store.games.set(g.id,g);store.save(g);
    const restored=openGameStore(dir).games.get(g.id)!;
    assert.equal(restored.current?.dailyDoubleFromId,a.id);assert.equal(restored.current?.answeringId,b.id);assert.equal(restored.current?.wagers[b.id].wager,500);
    act(restored,'finalBegin');store.save(restored);
    const active=openGameStore(dir).games.get(g.id)!;assert.equal(active.current?.phase,'question');assert.equal(active.current?.answeringId,b.id);
    act(active,'judge',{correct:false});assert.equal(active.players.find(p=>p.id===b.id)?.score,-500);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

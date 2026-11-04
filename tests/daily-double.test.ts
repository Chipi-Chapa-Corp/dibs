import {startReadyGame} from './helpers.ts';
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
  const q=g.rounds[0].categories[0].questions[0];q.dailyDouble=true;startReadyGame(g);act(g,'openQuestion',{questionId:q.id});
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
  for(const player of [a,b,other])assert.throws(()=>act(g,'wager',{wager:500},'player',player.id),/presenter records/);
  assert.throws(()=>act(g,'assignDailyDouble',{fromId:a.id,playerId:other.id},'player',b.id),/Host access/);
  assert.throws(()=>act(g,'hostWager',{playerId:other.id,wager:500}),/assigned team/);
  assert.throws(()=>act(g,'finalBegin'),/collect/);
  // Host offers any point amounts aloud, independent of score and Final wager limits.
  for(const bad of [-1,NaN,Infinity,1.5,10000001])assert.throws(()=>act(g,'hostWager',{playerId:b.id,wager:bad}),/Enter a whole wager/);
  act(g,'hostWager',{playerId:b.id,wager:750});
  assert.equal(b.score,0);assert.equal(g.current?.wagers[b.id].wager,750);
  assert.equal(view(g,'stage').current?.wagers[b.id].wager,750);
  assert.equal(view(g,'player',b.id).yourFinal?.wager,750);
  for(const role of ['stage','player']as const){const snapshot=view(g,role,b.id);assert.equal(snapshot.currentQuestion?.prompt,'');assert.equal(snapshot.currentQuestion?.answer,'');}
  assert.throws(()=>act(g,'wager',{wager:900},'player',b.id),/presenter records/);
  act(g,'hostWager',{playerId:b.id,wager:900});act(g,'finalBegin');
  assert.equal(g.current?.phase,'question');assert.equal(g.current?.buzzOpen,false);assert.equal(view(g,'stage').currentQuestion?.prompt,q.prompt);
});

test('only the assigned team is judged; wrong answers lose the wager without a buzzer race',()=>{
  for(const correct of [true,false]){
    const{g,a,b,other}=fixture();g.settings.autoOpenBuzzers=true;g.settings.deductWrong=false;
    act(g,'assignDailyDouble',{fromId:a.id,playerId:b.id});act(g,'hostWager',{playerId:b.id,wager:750});act(g,'finalBegin');
    for(const action of ['openBuzzers','resetBuzzers','answerer'])assert.throws(()=>act(g,action,{playerId:other.id}),/required answerer/);
    for(const player of [a,b,other])assert.throws(()=>act(g,'buzz',{},'player',player.id),/assigned team/);
    assert.throws(()=>act(g,'judge',{playerId:other.id,correct}),/assigned team/);
    assert.throws(()=>act(g,'assignDailyDouble',{fromId:a.id,playerId:other.id}),/awaiting assignment/);
    assert.throws(()=>act(g,'removeTeam',{playerId:b.id}),/fixed/);
    act(g,'judge',{correct});assert.equal(g.players.find(p=>p.id===b.id)?.score,correct?750:-750);assert.equal(a.score,0);assert.equal(other.score,0);
    assert(g.current?.closed);assert(!g.current?.buzzOpen);assert.throws(()=>act(g,'judge',{correct}),/No active question/);
    act(g,'undo');assert.equal(g.players.find(p=>p.id===b.id)?.score,0);assert.equal(g.current,null);
  }
});

test('reassignment clears the previous wager; question undo cancels selection and restart preserves a new assignment',()=>{
  const{g,a,b,other}=fixture();act(g,'assignDailyDouble',{fromId:a.id,playerId:b.id});act(g,'hostWager',{playerId:b.id,wager:500});
  act(g,'assignDailyDouble',{fromId:a.id,playerId:other.id});assert.deepEqual(g.current?.wagers,{});
  assert.throws(()=>act(g,'wager',{wager:500},'player',b.id),/presenter records/);
  act(g,'undo');assert.equal(g.current,null);act(g,'openQuestion',{questionId:g.rounds[0].categories[0].questions[0].id});act(g,'assignDailyDouble',{fromId:a.id,playerId:b.id});act(g,'hostWager',{playerId:b.id,wager:500});
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

test('presenter records spoken Daily Double choices step by step; phones cannot change teams or wagers',()=>{
  const{g,a,b,other,q}=fixture();
  for(const player of [a,b,other])assert.throws(()=>act(g,'chooseDailyDoubleOpponent',{playerId:b.id},'player',player.id),/Host access/);
  assert.throws(()=>act(g,'setDailyDoubleChooser',{playerId:a.id},'player',a.id),/Host access/);
  act(g,'setDailyDoubleChooser',{playerId:a.id});
  assert.equal(g.current?.dailyDoubleFromId,a.id);assert.equal(g.current?.answeringId,null);
  assert.throws(()=>act(g,'finalBegin'),/Assign another team/);
  assert.throws(()=>act(g,'assignDailyDouble',{fromId:a.id,playerId:b.id},'player',a.id),/Host access/);
  assert.throws(()=>act(g,'assignDailyDouble',{fromId:a.id,playerId:a.id}),/different team/);
  for(const role of ['stage','player']as const)assert.equal(view(g,role,a.id).currentQuestion?.prompt,'');
  act(g,'pause');assert.throws(()=>act(g,'assignDailyDouble',{fromId:a.id,playerId:b.id}),/awaiting assignment/);act(g,'pause');
  act(g,'assignDailyDouble',{fromId:a.id,playerId:b.id});
  assert.equal(g.current?.answeringId,b.id);
  for(const player of [a,b,other])assert.throws(()=>act(g,'wager',{wager:500},'player',player.id),/presenter records/);
  act(g,'hostWager',{playerId:b.id,wager:500});assert.equal(g.current?.wagers[b.id].wager,500);
  assert.throws(()=>act(g,'finalBegin',{},'player',b.id),/Host access/);
  act(g,'finalBegin');assert.equal(view(g,'stage').currentQuestion?.prompt,q.prompt);assert.equal(g.current?.buzzOpen,false);
  act(g,'judge',{correct:false});assert.equal(g.players.find(p=>p.id===b.id)?.score,-500);assert.equal(g.players.find(p=>p.id===a.id)?.score,0);assert.equal(g.players.find(p=>p.id===other.id)?.score,0);
  assert.equal(g.current?.wagers[b.id].judged,true);assert.equal(g.current?.wagers[b.id].correct,false);
  act(g,'undo');assert.equal(g.current,null);assert.equal(g.players.find(p=>p.id===b.id)?.score,0);
});

test('Daily Double handoffs persist between turns and host corrections clear the old choice',()=>{
  const{g,a,b,other}=fixture();const dir=mkdtempSync(join(tmpdir(),'dibs-daily-handoff-'));
  try{
    const saveAndReload=(game:typeof g)=>{const store=openGameStore(dir);store.games.set(game.id,game);store.save(game);return openGameStore(dir).games.get(game.id)!;};
    act(g,'setDailyDoubleChooser',{playerId:a.id});
    const choosing=saveAndReload(g);assert.equal(choosing.current?.dailyDoubleFromId,a.id);assert.equal(choosing.current?.answeringId,null);
    act(choosing,'assignDailyDouble',{fromId:a.id,playerId:b.id});
    const wagering=saveAndReload(choosing);assert.equal(wagering.current?.answeringId,b.id);
    act(wagering,'hostWager',{playerId:b.id,wager:750});
    const ready=saveAndReload(wagering);assert.equal(ready.current?.wagers[b.id].wager,750);
    act(ready,'setDailyDoubleChooser',{playerId:other.id});assert.equal(ready.current?.answeringId,null);assert.deepEqual(ready.current?.wagers,{});
    assert.throws(()=>act(ready,'assignDailyDouble',{fromId:other.id,playerId:b.id},'player',a.id),/Host access/);
    act(ready,'assignDailyDouble',{fromId:other.id,playerId:a.id});
    act(ready,'hostWager',{playerId:a.id,wager:200});act(ready,'finalBegin');assert.equal(ready.current?.answeringId,a.id);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

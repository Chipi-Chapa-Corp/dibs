import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {act,addPlayer,createGame,joinMember,removeMember,tick,view} from '../server/engine.ts';
import {openGameStore} from '../server/storage.ts';
import {demoRounds} from '../shared/model.ts';
import {startReadyGame} from './helpers.ts';

function fixture(kind:'board'|'dailyDouble'|'final'='board',delay=900){
  const rounds=demoRounds();if(kind==='dailyDouble')rounds[0].categories[0].questions[0].dailyDouble=true;
  const game=createGame({definition:{rounds,settings:{revealDelayMs:delay,earlyPenaltyMs:0}}});
  const red=addPlayer(game,'Red'),blue=addPlayer(game,'Blue'),green=addPlayer(game,'Green');red.score=1000;
  const member=joinMember(game,{name:'Alice',teamId:red.id});startReadyGame(game);
  if(kind==='final')act(game,'round',{index:2});else act(game,'openQuestion',{questionId:rounds[0].categories[0].questions[0].id});
  if(kind==='dailyDouble')act(game,'assignDailyDouble',{fromId:blue.id,playerId:red.id});
  if(kind!=='board'){act(game,'hostWager',{playerId:red.id,wager:300});act(game,'finalBegin');}
  const q=view(game,'host').currentQuestion!;
  const grade=(result:string)=>act(game,'gradeTeam',{questionId:q.id,playerId:red.id,result});
  const resolve=(teamId:string,correct:boolean)=>{act(game,'buzz',{},'player',teamId);act(game,'resolveAnswer',{questionId:q.id,playerId:teamId,answerToken:game.current!.answerToken,correct});};
  const next=(now=Date.now())=>act(game,'continueQuestion',{questionId:q.id},'host',null,now);
  return{game,red,blue,green,member,q,grade,resolve,next};
}

for(const kind of ['dailyDouble','final']as const)test(`${kind}: scoring stays private until Continue and remains on screen until the next Continue`,()=>{
  const{game,q,grade,next}=fixture(kind,0);grade('correct');
  assert.equal(game.current?.revealAt,null);assert.equal(view(game,'stage').currentQuestion?.answer,'');
  grade('incorrect');assert.equal(view(game,'stage').currentQuestion?.answer,'');grade('correct');next();
  assert.equal(view(game,'stage').currentQuestion?.answer,q.answer);assert.equal(game.players[0].score,1300);
  next();assert.equal(game.current,null);assert.equal(game.players[0].score,1300);
});

test('special-question Continue waits for the reveal instead of closing during the animation',()=>{
  const{game,q,grade,next}=fixture('final');grade('correct');next(1000);
  assert.equal(game.current?.revealAt,1900);assert.throws(()=>next(1100),/Wait until the answer/);
  tick(game,1900);assert.equal(view(game,'stage').currentQuestion?.answer,q.answer);next(1901);assert.equal(game.current,null);
});

test('Undo cancels the question selection and its scores, preserving memberships and pause state',()=>{
  const{game,red,blue,green,member,resolve,q}=fixture();resolve(red.id,false);resolve(blue.id,false);
  act(game,'adjust',{playerId:red.id,amount:50});act(game,'buzz',{},'player',green.id);assert.equal(game.undo.length,1);
  removeMember(game,member.id);const replacement=joinMember(game,{name:'Alice',teamId:red.id});act(game,'pause');act(game,'undo');
  assert.equal(game.current,null);assert.equal(game.selection,null);assert(!game.played.includes(q.id));assert(game.paused);
  assert.deepEqual(game.players.map(t=>t.score),[1000,0,0]);assert.deepEqual(game.players.map(t=>t.stats.correct),[0,0,0]);assert(game.teamsLocked);
  assert(!game.members.some(m=>m.id===member.id));assert(game.members.some(m=>m.id===replacement.id));assert.equal(view(game,'host').canUndo,false);
});

test('successive Undo clicks cancel successive question selections rather than answer decisions',()=>{
  const{game,q,resolve,blue,next}=fixture('board',0);resolve(game.players[0].id,true);next();
  const second=game.rounds[0].categories[0].questions[1];act(game,'selectQuestion',{questionId:second.id},'host',null,1000);tick(game,1800);
  act(game,'buzz',{},'player',blue.id);act(game,'resolveAnswer',{questionId:second.id,playerId:blue.id,answerToken:game.current!.answerToken,correct:false});act(game,'undo');
  assert.equal(game.current,null);assert(game.played.includes(q.id));assert(!game.played.includes(second.id));assert.deepEqual(game.players.map(t=>t.score),[1100,0,0]);
  act(game,'undo');assert(!game.played.includes(q.id));assert.deepEqual(game.players.map(t=>t.score),[1000,0,0]);assert.equal(game.status,'playing');
  assert.throws(()=>act(game,'undo'),/Nothing to undo/);
});

test('older correct results reveal on load and wait for Continue; question undo remains available',()=>{
  const{game,red,q}=fixture();const checkpoint=game.undo[0] as Record<string,unknown>;delete checkpoint.undoKind;
  const{undo:_undo,...beforeGrade}=structuredClone(game);game.undo.push(beforeGrade);
  act(game,'judge',{playerId:red.id,correct:true});const{undo:_afterUndo,...afterGrade}=structuredClone(game);game.undo.push(afterGrade);
  const dir=mkdtempSync(join(tmpdir(),'dibs-question-controls-'));
  try{
    openGameStore(dir).save(game);const restored=openGameStore(dir).games.get(game.id)!;
    assert.equal(restored.undo.length,1);assert.equal(restored.current?.questionId,q.id);assert(restored.current?.revealAt);assert(!restored.current?.buzzOpen);assert(!restored.played.includes(q.id));assert.equal(restored.players[0].score,1100);
    act(restored,'undo');assert.equal(restored.current,null);assert(!restored.played.includes(q.id));assert.equal(restored.players.find(t=>t.id===red.id)?.score,1000);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Continue rejects player access, stale questions, unresolved regular questions and unopened wagers',()=>{
  const{game,q,red}=fixture();
  assert.throws(()=>act(game,'continueQuestion',{questionId:q.id},'player',red.id),/Host access/);
  assert.throws(()=>act(game,'continueQuestion',{questionId:'old-question'}),/no longer active/);
  assert.throws(()=>act(game,'continueQuestion',{questionId:q.id}),/Judge the answering team/);
  act(game,'round',{index:2});assert.throws(()=>act(game,'continueQuestion',{questionId:game.current!.questionId}),/Open the question/);
});

for(const exhausted of [false,true])test(`End question reveals without scoring and waits for Continue (${exhausted?'all teams wrong':'active answerer'})`,()=>{
  const{game,q,red,blue,green,resolve,next}=fixture();
  if(exhausted)for(const team of [red,blue,green])resolve(team.id,false);
  else act(game,'buzz',{},'player',red.id);
  const scores=game.players.map(t=>({score:t.score,stats:{...t.stats}}));
  act(game,'endQuestion',{questionId:q.id},'host',null,1000);
  assert.equal(game.current?.closed,true);assert.equal(game.current?.answeringId,null);assert.equal(game.current?.answerToken,null);assert.equal(game.current?.buzzOpen,false);
  assert.equal(game.current?.revealAt,1900);assert(!game.played.includes(q.id));assert.equal(view(game,'stage').currentQuestion?.answer,'');
  assert.throws(()=>act(game,'buzz',{},'player',blue.id),/No active question/);
  assert.throws(()=>next(1100),/Wait until the answer/);
  act(game,'endQuestion',{questionId:q.id},'host',null,1200);assert.equal(game.current?.revealAt,1900);
  tick(game,1900);assert.equal(view(game,'stage').currentQuestion?.answer,q.answer);assert.equal(game.current?.questionId,q.id);
  assert.deepEqual(game.players.map(t=>({score:t.score,stats:t.stats})),scores);
  next(1901);assert.equal(game.current,null);assert(game.played.includes(q.id));
});

test('ended question survives a restart with its reveal and Continue state intact',()=>{
  const{game,q}=fixture('board',0);act(game,'endQuestion',{questionId:q.id});
  assert.deepEqual(game.players.map(t=>t.score),[1000,0,0]);assert.equal(game.current?.answeringId,null);
  const dir=mkdtempSync(join(tmpdir(),'dibs-ended-question-'));
  try{
    openGameStore(dir).save(game);const restored=openGameStore(dir).games.get(game.id)!;
    assert.equal(restored.current?.closed,true);assert.equal(restored.current?.buzzOpen,false);assert.equal(view(restored,'stage').currentQuestion?.answer,q.answer);
    assert(!restored.played.includes(q.id));act(restored,'continueQuestion',{questionId:q.id});assert.equal(restored.current,null);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('End question rejects players, stale questions, paused games and special questions',()=>{
  const{game,q,red}=fixture();
  assert.throws(()=>act(game,'endQuestion',{questionId:q.id},'player',red.id),/Host access/);
  assert.throws(()=>act(game,'endQuestion',{questionId:'old-question'}),/no longer active/);
  act(game,'pause');assert.throws(()=>act(game,'endQuestion',{questionId:q.id}),/No active question/);
  const special=fixture('dailyDouble');assert.throws(()=>act(special.game,'endQuestion',{questionId:special.q.id}),/special question/);
});

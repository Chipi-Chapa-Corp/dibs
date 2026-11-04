import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {act,addPlayer,createGame,joinMember,normalizeStoredGameplay,view} from '../server/engine.ts';
import {openGameStore} from '../server/storage.ts';
import {demoRounds} from '../shared/model.ts';
import {startReadyGame} from './helpers.ts';

function fixture(){
  const g=createGame({definition:{rounds:demoRounds()}}),a=addPlayer(g,'Alpha'),b=addPlayer(g,'Beta');a.score=1200;b.score=900;
  const one=joinMember(g,{name:'Alice',teamId:a.id}),two=joinMember(g,{name:'Alex',teamId:a.id});
  startReadyGame(g);act(g,'round',{index:2});const questionId=g.current!.questionId;
  const wager=(teamId:string,amount:number,version=0)=>act(g,'wager',{questionId,wager:amount,version},'player',teamId);
  const answer=(teamId:string,value:string,version=0)=>act(g,'finalAnswer',{questionId,answer:value,version},'player',teamId);
  const lock=()=>act(g,'lockFinalAnswers',{questionId});
  const grade=(teamId:string,result='correct')=>act(g,'gradeTeam',{questionId,playerId:teamId,result});
  return{g,a,b,one,two,questionId,wager,answer,lock,grade};
}

test('phone wagers are shared, editable, validated and versioned until every wager is locked',()=>{
  const{g,a,b,questionId,wager}=fixture();
  assert.throws(()=>act(g,'finalBegin'),/every team/);
  for(const amount of [-1,1201,1.5,Infinity,NaN,'100',null])assert.throws(()=>act(g,'wager',{questionId,wager:amount,version:0},'player',a.id),/whole wager/);
  wager(a.id,731);assert.equal(view(g,'player',a.id).yourFinal?.wager,731);
  assert.throws(()=>wager(a.id,500),/teammate updated/);wager(a.id,600,1);
  assert.throws(()=>act(g,'finalBegin'),/every team/);wager(b.id,0);act(g,'finalBegin');
  assert.equal(g.current?.answersLocked,false);assert.equal(view(g,'player',a.id).currentQuestion?.prompt,g.rounds[2].categories[0].questions[0].prompt);
  assert.throws(()=>wager(a.id,100,2),/Wagers are closed/);
  assert.throws(()=>act(g,'lockFinalAnswers',{questionId},'player',a.id),/Host access/);
});

test('answers share versions across teammates, accept free text, and lock before judging',()=>{
  const{g,a,b,questionId,wager,answer,lock,grade}=fixture();wager(a.id,731);wager(b.id,319);
  assert.throws(()=>answer(a.id,'Too early'),/Answers are closed/);act(g,'finalBegin');
  assert.throws(()=>grade(a.id),/Lock answers/);
  answer(a.id,'Первый ответ 🌚\n<script>plain text</script>');
  assert.throws(()=>answer(a.id,'Stale edit'),/teammate updated/);
  answer(a.id,'Исправленный ответ',1);assert.equal(view(g,'player',a.id).yourFinal?.answer,'Исправленный ответ');
  assert.throws(()=>answer(b.id,'x'.repeat(5001)),/5000/);
  answer(b.id,' \n');assert.equal(g.current?.wagers[b.id].answerSubmitted,false);
  answer(b.id,'Final answer',1);lock();
  assert.throws(()=>answer(a.id,'Too late',2),/Answers are closed/);
  grade(a.id);grade(b.id,'incorrect');grade(a.id,'incorrect');grade(a.id);
  assert.equal(g.players[0].score,1931);assert.equal(g.players[1].score,581);assert.equal(g.players[0].stats.correct,1);assert.equal(g.players[0].stats.incorrect,0);
  assert.throws(()=>act(g,'gradeTeam',{questionId,playerId:a.id,result:'pass'}),/Correct or Incorrect/);
});

test('pending final hides all wager, answer and grading side channels from other teams and Presenter',()=>{
  const{g,a,b,questionId,wager,answer,lock,grade}=fixture();wager(a.id,731);wager(b.id,319);act(g,'finalBegin');
  answer(a.id,'ALPHA_PRIVATE_ANSWER');answer(b.id,'BETA_PRIVATE_ANSWER');lock();
  assert.equal(view(g,'stage',a.id).yourFinal,null);
  const before=[view(g,'stage'),view(g,'player',b.id)];grade(a.id);grade(b.id,'incorrect');
  for(const role of ['stage','player']as const){
    const v=view(g,role,role==='player'?b.id:undefined),serialized=JSON.stringify(v);
    assert(!serialized.includes('ALPHA_PRIVATE_ANSWER'));assert(!serialized.includes(g.rounds[2].categories[0].questions[0].answer));
    assert.equal(v.current?.wagers[a.id].wager,0);assert.equal(v.current?.wagers[a.id].answer,'');
    assert.equal(v.current?.wagers[a.id].correct,undefined);assert.equal(v.current?.wagers[a.id].judged,false);
    assert.equal(v.current?.judgments,undefined);assert.deepEqual(v.current?.incorrectTeamIds,[]);
    assert.deepEqual(v.history,[]);assert.deepEqual(v.finalPresentation?.wagers,{});
    assert.deepEqual(v.players.map(p=>p.score),[1200,900]);assert.deepEqual(v.players.map(p=>p.stats),before[role==='stage'?0:1].players.map(p=>p.stats));
    if(role==='player'){assert.equal(v.yourFinal?.wager,319);assert.equal(v.yourFinal?.answer,'BETA_PRIVATE_ANSWER');assert.equal(v.yourFinal?.correct,undefined);assert.equal(v.yourFinal?.judged,false);}
  }
  for(const action of ['reveal','closeQuestion'])assert.throws(()=>act(g,action),/Finish the game/);
  act(g,'continueQuestion',{questionId});
  const publicResult=view(g,'stage');assert.equal(publicResult.current?.wagers[a.id].answer,'ALPHA_PRIVATE_ANSWER');assert.equal(publicResult.current?.wagers[a.id].wager,731);assert.deepEqual(publicResult.players.map(p=>p.score),[1931,581]);assert.equal(publicResult.currentQuestion?.answer,g.rounds[2].categories[0].questions[0].answer);
});

test('host overrides support paper or disconnected phones, including correcting wagers after judging without double scoring',()=>{
  const{g,a,b,questionId,wager,lock,grade}=fixture();
  const override=(playerId:string,wager:number,answer:string)=>{const e=g.current!.wagers[playerId];act(g,'hostFinalEntry',{questionId,playerId,wager,answer,wagerVersion:e?.wagerVersion||0,answerVersion:e?.answerVersion||0});};
  override(a.id,600,'');wager(b.id,0);act(g,'finalBegin');override(a.id,500,'Answer from paper');lock();grade(a.id);
  assert.equal(a.score,1700);override(a.id,400,'Corrected transcription');assert.equal(a.score,1600);assert.equal(a.stats.correct,1);
  grade(a.id,'incorrect');assert.equal(a.score,800);override(a.id,300,'Same answer');assert.equal(a.score,900);assert.equal(a.stats.incorrect,1);
  const entry=g.current!.wagers[a.id];assert.throws(()=>act(g,'hostFinalEntry',{questionId,playerId:a.id,wager:100,answer:'stale',wagerVersion:0,answerVersion:0}),/changed/);
  assert.equal(entry.wager,300);assert.throws(()=>act(g,'hostFinalEntry',{questionId,playerId:a.id,wager:0,answer:'bad'},'player',a.id),/Host access/);
});

test('zero and negative scores allow a zero wager, unlimited wagers still require whole valid amounts',()=>{
  const{g,a,b,wager}=fixture();a.score=-500;b.score=0;g.finalPresentation!.scores={[a.id]:-500,[b.id]:0};
  assert.throws(()=>wager(a.id,1),/between 0 and 0/);wager(a.id,0);wager(b.id,0);act(g,'finalBegin');
  const other=fixture();other.g.settings.finalMaxWager='unlimited';other.wager(other.a.id,1e7);assert.throws(()=>other.wager(other.b.id,1e7+1),/whole wager/);
});

test('lock missing answers for a paper game, reject paused or stale edits, and preserve submissions through restart/rejoin',()=>{
  const{g,a,b,one,two,questionId,wager,answer,lock}=fixture();wager(a.id,731);wager(b.id,0);act(g,'finalBegin');answer(a.id,'Saved before disconnect');
  act(g,'pause');assert.throws(()=>answer(a.id,'Paused',1),/not running/);assert.throws(lock,/Answers are closed/);act(g,'pause');
  assert.throws(()=>act(g,'finalAnswer',{questionId:'old',answer:'Old page',version:1},'player',a.id),/no longer active/);
  const dir=mkdtempSync(join(tmpdir(),'dibs-private-final-'));
  try{
    openGameStore(dir).save(g);const restored=openGameStore(dir).games.get(g.id)!;
    assert.equal(joinMember(restored,{token:one.token}).id,one.id);assert.equal(joinMember(restored,{token:two.token}).teamId,a.id);
    assert.equal(view(restored,'player',a.id).yourFinal?.answer,'Saved before disconnect');assert.equal(restored.current?.answersLocked,false);
    act(restored,'lockFinalAnswers',{questionId});assert.throws(()=>act(restored,'finalAnswer',{questionId,answer:'Late',version:1},'player',a.id),/closed/);
    openGameStore(dir).save(restored);assert.equal(openGameStore(dir).games.get(g.id)?.current?.answersLocked,true);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('legacy finals resume safely: already-graded answers stay locked; ungraded answers remain editable',()=>{
  const{g,a,b,wager}=fixture();wager(a.id,100);wager(b.id,0);act(g,'finalBegin');delete g.current!.answersLocked;normalizeStoredGameplay(g);assert.equal(g.current?.answersLocked,false);
  delete g.current!.answersLocked;g.current!.wagers[a.id].judged=true;normalizeStoredGameplay(g);assert.equal(g.current?.answersLocked,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {act,addPlayer,createGame,updateDefinition,view} from '../server/engine.ts';
import {openGameStore} from '../server/storage.ts';
import {demoRounds,emptyQuestion} from '../shared/model.ts';
import {startReadyGame} from './helpers.ts';

function fixture(count=3){
  const rounds=demoRounds(),round=rounds[2];
  round.categories=Array.from({length:count},(_,i)=>({id:`category-${i}`,name:`Final category ${i+1}`,questions:[{...emptyQuestion(0),id:`question-${i}`,prompt:`PRIVATE_CLUE_${i}`,answer:`PRIVATE_ANSWER_${i}`,notes:`PRIVATE_NOTE_${i}`}]}));
  const g=createGame({definition:{rounds}}),a=addPlayer(g,'Alpha'),b=addPlayer(g,'Beta');
  a.score=2000;b.score=1000;startReadyGame(g);act(g,'round',{index:2});
  const reject=(index:number,rejected=true)=>act(g,'setFinalCategoryRejected',{roundId:round.id,categoryId:`category-${index}`,rejected});
  const choose=()=>act(g,'chooseFinalCategory',{roundId:round.id});
  return{g,a,b,round,reject,choose};
}

test('host crosses out and restores categories; only the last survivor can open for wagers',()=>{
  const{g,a,round,reject,choose}=fixture();
  assert.equal(g.current,null);
  assert.throws(choose,/only one remains/);
  assert.throws(()=>act(g,'openQuestion',{questionId:'question-0'}),/only one remains/);
  assert.throws(()=>act(g,'selectQuestion',{questionId:'question-0'}),/only one remains/);
  assert.throws(()=>act(g,'wager',{questionId:'question-0',wager:100,version:0},'player',a.id),/no longer active/);
  reject(0);reject(0);assert.deepEqual(g.finalCategorySelection?.rejectedCategoryIds,['category-0']);
  reject(0,false);assert.deepEqual(g.finalCategorySelection?.rejectedCategoryIds,[]);
  reject(0);reject(1);
  assert.throws(()=>reject(2),/Keep one/);
  assert.throws(()=>act(g,'openQuestion',{questionId:'question-0'}),/only one remains/);
  choose();const current=view(g,'host').current;assert.equal(current?.questionId,'question-2');assert.equal(current?.category,'Final category 3');assert.equal(current?.phase,'wager');
  assert.throws(()=>reject(0,false),/selection is closed/);
  assert.throws(choose,/selection is closed/);
  assert.equal(g.rounds[2].id,round.id);
});

test('final elimination rejects players, stale requests, invalid categories and paused actions',()=>{
  const{g,a,round,reject,choose}=fixture();
  const before=structuredClone(g);
  for(const action of ['setFinalCategoryRejected','chooseFinalCategory'])assert.throws(()=>act(g,action,{roundId:round.id,categoryId:'category-0',rejected:true},'player',a.id),/Host access/);
  assert.throws(()=>act(g,'setFinalCategoryRejected',{roundId:'old',categoryId:'category-0',rejected:true}),/no longer active/);
  assert.throws(()=>act(g,'chooseFinalCategory',{roundId:'old'}),/no longer active/);
  assert.throws(()=>act(g,'setFinalCategoryRejected',{roundId:round.id,categoryId:'missing',rejected:true}),/not found/);
  assert.throws(()=>act(g,'setFinalCategoryRejected',{roundId:round.id,categoryId:'category-0',rejected:'yes'}),/whether/);
  assert.deepEqual(g,before);
  act(g,'pause');assert.throws(()=>reject(0),/selection is closed/);assert.throws(choose,/selection is closed/);
  act(g,'pause');assert.throws(()=>act(g,'finish'),/Lock answers/);
  act(g,'round',{index:0});assert.throws(()=>reject(0),/selection is closed/);
});

test('selection survives disk reload, keeps questions secret, and leads into the full private final',()=>{
  const{g,a,b,round,reject}=fixture();reject(0);
  for(const role of ['player','stage'] as const){
    const publicView=view(g,role,a.id),json=JSON.stringify(publicView);
    assert(publicView.rounds[2].categories.some(c=>c.name==='Final category 1'));
    assert.deepEqual(publicView.finalCategorySelection?.rejectedCategoryIds,['category-0']);
    assert(!json.includes('PRIVATE_'));assert.equal(publicView.currentQuestion,null);
  }
  const directory=mkdtempSync(join(tmpdir(),'dibs-final-categories-'));
  try{
    const store=openGameStore(directory);store.save(g);
    const restored=openGameStore(directory).games.get(g.id)!;
    assert.deepEqual(restored.finalCategorySelection,g.finalCategorySelection);
    act(restored,'setFinalCategoryRejected',{roundId:round.id,categoryId:'category-1',rejected:true});
    act(restored,'chooseFinalCategory',{roundId:round.id});
    const questionId=restored.current!.questionId;
    assert.equal(view(restored,'stage').currentQuestion?.prompt,'');
    for(const [teamId,wager]of [[a.id,700],[b.id,400]] as const)act(restored,'wager',{questionId,wager,version:0},'player',teamId);
    assert.equal(view(restored,'player',b.id).current?.wagers[a.id].wager,0);
    act(restored,'finalBegin');assert.equal(view(restored,'stage').currentQuestion?.prompt,'PRIVATE_CLUE_2');
    for(const teamId of [a.id,b.id])act(restored,'finalAnswer',{questionId,answer:`SECRET_${teamId}`,version:0},'player',teamId);
    act(restored,'lockFinalAnswers',{questionId});
    act(restored,'gradeTeam',{questionId,playerId:a.id,result:'correct'});
    act(restored,'gradeTeam',{questionId,playerId:b.id,result:'incorrect'});
    const pending=view(restored,'stage');assert.deepEqual(pending.players.map(p=>p.score),[2000,1000]);assert(!JSON.stringify(pending).includes('SECRET_'));
    act(restored,'continueQuestion',{questionId});
    const finished=view(restored,'stage');assert.equal(finished.status,'finished');assert.deepEqual(finished.players.map(p=>p.score),[2700,600]);assert.equal(finished.currentQuestion?.answer,'PRIVATE_ANSWER_2');
    act(restored,'reset');assert.equal(restored.finalCategorySelection,undefined);assert.equal(restored.rounds[2].categories.length,3);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('one-question finals remain compatible and empty survivors cannot start wagering',()=>{
  const single=fixture(1);assert.equal(single.g.current?.phase,'wager');
  const{g,reject,choose}=fixture();g.rounds[2].categories[2].questions[0].prompt='';reject(0);reject(1);
  assert.throws(choose,/Add a question/);assert.equal(g.current,null);
});

test('final definitions support 20 categories, preserve all content and reject extra questions atomically',()=>{
  const{g}=fixture(20);assert.equal(g.rounds[2].categories.length,20);assert(g.rounds[2].categories.every(c=>c.questions[0].responseType==='free'));
  const before=structuredClone(g.rounds),rounds=structuredClone(g.rounds);
  rounds[2].categories[0].questions.push({...emptyQuestion(0),prompt:'Extra question'});
  assert.throws(()=>updateDefinition(g,{rounds}),/one question/);assert.deepEqual(g.rounds,before);
  rounds[2].categories[0].questions.pop();rounds[2].categories.push({id:'extra',name:'Extra',questions:[]});
  assert.throws(()=>updateDefinition(g,{rounds}),/20 final categories/);assert.deepEqual(g.rounds,before);
});

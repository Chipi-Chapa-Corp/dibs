import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {act,addPlayer,createGame,view} from '../server/engine.ts';
import {openGameStore} from '../server/storage.ts';
import {demoRounds} from '../shared/model.ts';
import {collectMissingFinalWagers,lockFinalAnswers,startReadyGame} from './helpers.ts';

function fixture(settings:Record<string,unknown>={}){
  const game=createGame({definition:{rounds:demoRounds(),settings:{earlyPenaltyMs:0,...settings}}});
  const red=addPlayer(game,'Red'),blue=addPlayer(game,'Blue'),green=addPlayer(game,'Green');startReadyGame(game);
  const q=game.rounds[0].categories[0].questions[0];act(game,'openQuestion',{questionId:q.id});
  const grade=(playerId:string,result:string)=>act(game,'gradeTeam',{questionId:q.id,playerId,result});
  return{game,red,blue,green,q,grade};
}

test('final team results use wagers and remain editable; other screens do not receive the grading ledger',()=>{
  const{game,red}=fixture();red.score=1000;act(game,'round',{index:2});act(game,'hostWager',{playerId:red.id,wager:600});collectMissingFinalWagers(game);act(game,'finalBegin');lockFinalAnswers(game);
  const grade=(result:string)=>act(game,'gradeTeam',{questionId:game.current!.questionId,playerId:red.id,result});
  grade('incorrect');assert.equal(red.score,400);assert.equal(game.current?.wagers[red.id].correct,false);delete game.current!.judgments;
  grade('correct');assert.equal(red.score,1600);assert.equal(game.current?.wagers[red.id].correct,true);
  assert.throws(()=>grade('pass'),/Correct or Incorrect/);
  for(const role of ['stage','player']as const)assert(!view(game,role,red.id).current?.judgments);
});

test('Presenter freezes pre-final scores and hides wagers through grading until Finish game',()=>{
  const{game,red,blue,green}=fixture({revealDelayMs:0});red.score=1000;blue.score=500;green.score=-100;
  act(game,'round',{index:2});
  act(game,'hostWager',{playerId:red.id,wager:600});act(game,'wager',{wager:300,version:0,questionId:game.current!.questionId},'player',blue.id);
  assert.equal(view(game,'stage').current?.wagers[red.id].wager,0);assert.equal(view(game,'stage').current?.wagers[blue.id].wager,0);
  collectMissingFinalWagers(game);act(game,'finalBegin');lockFinalAnswers(game);
  const questionId=game.current!.questionId,grade=(playerId:string,result:string)=>act(game,'gradeTeam',{questionId,playerId,result});
  grade(red.id,'correct');grade(blue.id,'incorrect');
  assert.deepEqual(view(game,'host').players.map(team=>team.score),[1600,200,-100]);
  const checkPresenter=()=>{
    const stage=view(game,'stage');assert.deepEqual(stage.players.map(team=>team.score),[1000,500,-100]);
    if(stage.current){
      assert.deepEqual(stage.current.incorrectTeamIds,[]);assert.deepEqual(stage.current.passedTeamIds,[]);
      assert.equal(stage.current.wagers[red.id].wager,0);assert.equal(stage.current.wagers[blue.id].wager,0);
      for(const entry of Object.values(stage.current.wagers)){assert.equal(entry.correct,undefined);assert.equal(entry.judged,false);}
    }
  };
  checkPresenter();grade(red.id,'incorrect');checkPresenter();
  act(game,'adjust',{playerId:red.id,amount:50});checkPresenter();assert.equal(red.score,450);
  assert.throws(()=>act(game,'reveal'),/Finish the game/);checkPresenter();grade(green.id,'incorrect');checkPresenter();
  assert.deepEqual(game.finalPresentation?.wagers,{[red.id]:600,[blue.id]:300,[green.id]:0});
  act(game,'continueQuestion',{questionId});assert.equal(game.status,'finished');assert(game.current);assert.deepEqual(view(game,'stage').players.map(team=>team.score),[450,200,-100]);
  act(game,'reset');assert.equal(game.finalPresentation,undefined);
});

test('pre-final scores survive restart, including migration of a final already being graded',()=>{
  for(const legacy of [false,true]){
    const{game,red}=fixture({allowNegative:false});red.score=1000;act(game,'round',{index:2});
    act(game,'hostWager',{playerId:red.id,wager:600});collectMissingFinalWagers(game);act(game,'finalBegin');lockFinalAnswers(game);
    act(game,'gradeTeam',{questionId:game.current!.questionId,playerId:red.id,result:'incorrect'});
    if(legacy)delete game.finalPresentation;
    const dir=mkdtempSync(join(tmpdir(),'dibs-final-scores-'));
    try{
      openGameStore(dir).save(game);const restored=openGameStore(dir).games.get(game.id)!;
      assert.equal(view(restored,'stage').players[0].score,1000);assert.equal(view(restored,'host').players[0].score,400);
      assert.equal(view(restored,'stage').current?.wagers[red.id].wager,0);
      act(restored,'gradeTeam',{questionId:restored.current!.questionId,playerId:red.id,result:'correct'});
      assert.equal(view(restored,'stage').players[0].score,1000);assert.equal(view(restored,'host').players[0].score,1600);
      act(restored,'round',{index:0});assert.equal(restored.finalPresentation,undefined);assert.equal(view(restored,'stage').players[0].score,1600);
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
});

test('the assigned Daily Double team can freely switch Correct and Incorrect before continuing',()=>{
  const{game,red,blue}=fixture();red.score=1000;
  act(game,'closeQuestion');const q=game.rounds[0].categories[0].questions[1];q.dailyDouble=true;
  act(game,'openQuestion',{questionId:q.id});act(game,'assignDailyDouble',{fromId:blue.id,playerId:red.id});act(game,'hostWager',{playerId:red.id,wager:500});act(game,'finalBegin');
  const grade=(result:string,playerId=red.id)=>act(game,'gradeTeam',{questionId:q.id,playerId,result});
  grade('incorrect');assert.equal(game.players[0].score,500);delete game.current!.judgments;
  grade('correct');assert.equal(game.players[0].score,1500);
  grade('incorrect');grade('incorrect');assert.equal(game.players[0].score,500);assert.equal(game.players[0].stats.incorrect,1);assert.equal(game.players[0].stats.correct,0);
  assert.throws(()=>grade('pass'),/must answer/);assert.throws(()=>grade('correct',blue.id),/assigned team/);
  assert.equal(game.current?.answeringId,red.id);assert.equal(game.current?.wagers[red.id].wager,500);
});

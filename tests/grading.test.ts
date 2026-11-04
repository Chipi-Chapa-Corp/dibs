import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {act,addPlayer,createGame,view} from '../server/engine.ts';
import {openGameStore} from '../server/storage.ts';
import {demoRounds} from '../shared/model.ts';
import {startReadyGame} from './helpers.ts';

function fixture(settings:Record<string,unknown>={}){
  const game=createGame({definition:{rounds:demoRounds(),settings:{earlyPenaltyMs:0,...settings}}});
  const red=addPlayer(game,'Red'),blue=addPlayer(game,'Blue'),green=addPlayer(game,'Green');startReadyGame(game);
  const q=game.rounds[0].categories[0].questions[0];act(game,'openQuestion',{questionId:q.id});
  const grade=(playerId:string,result:string)=>act(game,'gradeTeam',{questionId:q.id,playerId,result});
  return{game,red,blue,green,q,grade};
}

test('final team results use wagers and remain editable; other screens do not receive the grading ledger',()=>{
  const{game,red}=fixture();red.score=1000;act(game,'round',{index:2});act(game,'hostWager',{playerId:red.id,wager:600});act(game,'finalBegin');
  const grade=(result:string)=>act(game,'gradeTeam',{questionId:game.current!.questionId,playerId:red.id,result});
  grade('incorrect');assert.equal(red.score,400);assert.equal(game.current?.wagers[red.id].correct,false);delete game.current!.judgments;
  grade('correct');assert.equal(red.score,1600);assert.equal(game.current?.wagers[red.id].correct,true);
  grade('pass');assert.equal(red.score,1000);assert.equal(game.current?.wagers[red.id].judged,false);
  for(const role of ['stage','player']as const)assert(!view(game,role,red.id).current?.judgments);
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

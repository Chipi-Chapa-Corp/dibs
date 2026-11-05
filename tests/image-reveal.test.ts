import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {act,addPlayer,createGame,tick,view} from '../server/engine.ts';
import {openGameStore} from '../server/storage.ts';
import {demoRounds} from '../shared/model.ts';
import {imageRevealElapsed} from '../shared/image-reveal.ts';
import {collectMissingFinalWagers,startReadyGame} from './helpers.ts';

test('slow reveal is opt-in and survives saving, reordering and reloading questions',()=>{
  const rounds=demoRounds(),questions=rounds[0].categories[0].questions;
  questions[0].slowReveal=true;
  questions[1].slowReveal=false;
  const original=structuredClone(questions[0]);
  [questions[0],questions[2]]=[questions[2],questions[0]];
  const g=createGame({definition:{rounds}});
  const dir=mkdtempSync(join(tmpdir(),'dibs-image-reveal-'));
  try{
    openGameStore(dir).save(g);
    const saved=openGameStore(dir).games.get(g.id)!.rounds[0].categories[0].questions;
    assert.deepEqual(saved[2],original);
    assert.equal(saved[0].slowReveal,undefined);
    assert.equal(saved[1].slowReveal,false);
    const malformed=structuredClone(rounds);
    Object.assign(malformed[0].categories[0].questions[0],{slowReveal:'false'});
    assert.equal(createGame({definition:{rounds:malformed}}).rounds[0].categories[0].questions[0].slowReveal,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the reveal starts when a clue opens and buzzing or reconnecting cannot restart it',()=>{
  const g=createGame({definition:{rounds:demoRounds()}}),team=addPlayer(g,'Red');
  startReadyGame(g);
  const q=g.rounds[0].categories[0].questions[0];q.slowReveal=true;
  act(g,'openQuestion',{questionId:q.id},'host',null,1000);
  assert(g.current?.buzzOpen);
  act(g,'buzz',{},'player',team.id,1500);
  assert.equal(view(g,'stage',undefined,2500).current?.openedAt,1000);
  assert.equal(view(g,'stage',undefined,9000).current?.openedAt,1000);
  assert.equal(imageRevealElapsed(view(g,'stage',undefined,9000).current!,9000),500);
  assert.equal(view(g,'stage').currentQuestion?.slowReveal,true);
  assert.equal(view(g,'stage').currentQuestion?.answer,'');
  const dir=mkdtempSync(join(tmpdir(),'dibs-active-image-reveal-'));
  try{
    openGameStore(dir).save(g);
    const restored=openGameStore(dir).games.get(g.id)!;
    assert.equal(restored.current?.openedAt,1000);
    assert.equal(imageRevealElapsed(view(restored,'stage',undefined,10000).current!,10000),500);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

for(const result of ['incorrect','pass','correct'])test(`a buzz freezes progress until ${result} is recorded, then resumes without skipping ahead`,()=>{
  const g=createGame({definition:{rounds:demoRounds()}}),red=addPlayer(g,'Red'),blue=addPlayer(g,'Blue');
  startReadyGame(g);
  const q=g.rounds[0].categories[0].questions[0];q.slowReveal=true;
  act(g,'openQuestion',{questionId:q.id},'host',null,1000);
  act(g,'buzz',{},'player',red.id,2500);
  const decision={questionId:q.id,playerId:red.id,answerToken:g.current!.answerToken,result};
  assert.equal(g.current?.imageRevealPausedAt,2500);
  tick(g,15000);
  assert.equal(imageRevealElapsed(g.current!,15000),1500);
  assert.throws(()=>act(g,'resolveAnswer',{...decision,answerToken:'stale'},'host',null,16000),/no longer answering/);
  assert.equal(imageRevealElapsed(g.current!,16000),1500);
  act(g,'resolveAnswer',decision,'host',null,20000);
  assert.equal(g.current?.imageRevealPausedAt,undefined);
  assert.equal(g.current?.imageRevealPausedMs,17500);
  assert.equal(imageRevealElapsed(g.current!,20000),1500);
  assert.equal(imageRevealElapsed(g.current!,21000),2500);
  if(result!=='correct'){
    act(g,'buzz',{},'player',blue.id,21000);
    assert.equal(imageRevealElapsed(g.current!,30000),2500);
    act(g,'resolveAnswer',{questionId:q.id,playerId:blue.id,answerToken:g.current!.answerToken,result:'correct'},'host',null,35000);
    assert.equal(imageRevealElapsed(g.current!,36000),3500);
  }
});

test('game pauses and answering pauses overlap without counting the same time twice',()=>{
  const g=createGame({definition:{rounds:demoRounds()}}),team=addPlayer(g,'Red');
  startReadyGame(g);
  const q=g.rounds[0].categories[0].questions[0];q.slowReveal=true;
  act(g,'openQuestion',{questionId:q.id},'host',null,1000);
  act(g,'pause',{},'host',null,2000);
  assert.equal(imageRevealElapsed(g.current!,5000),1000);
  act(g,'pause',{},'host',null,6000);
  act(g,'buzz',{},'player',team.id,7000);
  act(g,'pause',{},'host',null,8000);
  act(g,'pause',{},'host',null,9000);
  assert.equal(g.current?.imageRevealPausedAt,7000);
  assert.equal(imageRevealElapsed(g.current!,10000),2000);
  act(g,'resolveAnswer',{questionId:q.id,playerId:team.id,answerToken:g.current!.answerToken,result:'incorrect'},'host',null,11000);
  assert.equal(g.current?.imageRevealPausedMs,8000);
  assert.equal(imageRevealElapsed(g.current!,11000),2000);
});

test('Daily Double and Final reveals start after wagering when the image becomes visible',()=>{
  const rounds=demoRounds();rounds[0].categories[0].questions[0].dailyDouble=true;
  rounds[0].categories[0].questions[0].slowReveal=true;
  const g=createGame({definition:{rounds}}),red=addPlayer(g,'Red'),blue=addPlayer(g,'Blue');
  startReadyGame(g);
  act(g,'openQuestion',{questionId:rounds[0].categories[0].questions[0].id},'host',null,1000);
  act(g,'assignDailyDouble',{fromId:red.id,playerId:blue.id});
  act(g,'hostWager',{playerId:blue.id,wager:500});
  act(g,'finalBegin',{},'host',null,10000);
  assert.equal(g.current?.phase,'question');
  assert.equal(g.current?.openedAt,10000);
  assert.equal(g.current?.imageRevealPausedAt,undefined);
  assert.equal(imageRevealElapsed(g.current!,11000),1000);
  act(g,'round',{index:2});
  collectMissingFinalWagers(g);
  act(g,'finalBegin',{},'host',null,20000);
  assert.equal(g.current?.phase,'final');
  assert.equal(g.current?.openedAt,20000);
});

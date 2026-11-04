import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,addPlayer} from '../server/engine.ts';
import {FINAL_ANSWER_MS,resultGroups,resultRevealAt,resultStep} from '../src/final-results';

test('results reveal from last to first without rearranging teams, grouping tied scores',()=>{
  const game=createGame();
  for(const[name,score]of [['Red',900],['Blue',-100],['Green',900],['Gold',400]]as const)addPlayer(game,name).score=score;
  const before=structuredClone(game.players),groups=resultGroups(game.players);
  assert.deepEqual(groups.map(group=>({rank:group.rank,score:group.score,names:group.teams.map(team=>team.name)})),[
    {rank:4,score:-100,names:['Blue']},{rank:3,score:400,names:['Gold']},{rank:1,score:900,names:['Red','Green']},
  ]);
  assert.deepEqual(game.players,before);
});

test('countdown hides every result, with an extra pause before the winning place',()=>{
  assert.equal(resultStep(0,3),-1);assert.equal(resultStep(2999,3),-1);
  assert.equal(resultStep(3000,3),0);assert.equal(resultStep(4699,3),0);
  assert.equal(resultStep(4700,3),1);assert.equal(resultStep(7299,3),1);
  assert.equal(resultStep(7300,3),2);assert.equal(resultRevealAt(2,3)-resultRevealAt(1,3),2600);
});

test('late displays resume the same reveal step, while completed or motion-free reveals show all places',()=>{
  const finishAt=10000;
  assert.equal(resultStep(15000-finishAt,3),1);
  assert.equal(resultStep(20000-finishAt,3),2);
  assert.equal(resultStep(Infinity,3),2);
});

test('final answer is shown before the countdown or any team result',()=>{
  assert.equal(resultStep(0-FINAL_ANSWER_MS,3),-1);
  assert.equal(resultStep(FINAL_ANSWER_MS-1-FINAL_ANSWER_MS,3),-1);
  assert.equal(resultStep(FINAL_ANSWER_MS+2999-FINAL_ANSWER_MS,3),-1);
  assert.equal(resultStep(FINAL_ANSWER_MS+3000-FINAL_ANSWER_MS,3),0);
});

test('one team and all-team ties reveal a shared winner after the countdown; empty games have no places',()=>{
  const game=createGame();assert.deepEqual(resultGroups(game.players),[]);assert.equal(resultStep(10000,0),-1);
  addPlayer(game,'Red');assert.equal(resultStep(3000,1),0);assert.equal(resultGroups(game.players)[0].rank,1);
  addPlayer(game,'Blue');const groups=resultGroups(game.players);
  assert.equal(groups.length,1);assert.equal(groups[0].teams.length,2);assert.equal(groups[0].rank,1);assert.equal(resultRevealAt(0,1),3000);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {act,addPlayer,createGame,joinMember} from '../server/engine.ts';
import {startReadyGame} from './helpers.ts';

test('one host action updates several scores while preserving other teams and memberships',()=>{
 const game=createGame(),red=addPlayer(game,'Red'),blue=addPlayer(game,'Blue'),green=addPlayer(game,'Green');
 const member=joinMember(game,{teamId:red.id,name:'Alice'});startReadyGame(game);green.score=350;
 act(game,'adjustScores',{scores:[{playerId:red.id,amount:-100},{playerId:blue.id,amount:200}]});
 assert.deepEqual(game.players.map(team=>team.score),[-100,200,350]);assert.equal(game.history[0].label,'Team scores adjusted');
 assert.deepEqual(game.history[0].deltas,{[red.id]:-100,[blue.id]:200});assert.equal(game.members[0].id,member.id);assert(game.teamsLocked);
});

test('bulk score updates reject invalid and duplicate teams without applying any scores',()=>{
 for(const bad of [
  {playerId:'missing',amount:0},
  {playerId:'red',amount:NaN},
  {playerId:'red',amount:Infinity},
  {playerId:'red',amount:'-100'},
  {playerId:'red',amount:1e9+1},
 ]){
  const game=createGame(),red=addPlayer(game,'Red'),blue=addPlayer(game,'Blue');
  const before=structuredClone(game);
  assert.throws(()=>act(game,'adjustScores',{scores:[{playerId:blue.id,amount:200},{...bad,playerId:bad.playerId==='red'?red.id:bad.playerId}]}));
  assert.deepEqual(game,before);
  assert.throws(()=>act(game,'adjustScores',{scores:[{playerId:red.id,amount:100},{playerId:red.id,amount:200}]}),/only be updated once/);assert.deepEqual(game,before);
  assert.throws(()=>act(game,'adjustScores',{scores:[]}));
 }
});

test('bulk scores require host access and follow the negative score setting',()=>{
 const game=createGame(),red=addPlayer(game,'Red'),blue=addPlayer(game,'Blue');game.settings.allowNegative=false;
 const scores=[{playerId:red.id,amount:-100},{playerId:blue.id,amount:200}];
 assert.throws(()=>act(game,'adjustScores',{scores},'player',red.id),/Host access/);
 act(game,'adjustScores',{scores});assert.deepEqual(game.players.map(team=>team.score),[0,200]);
});

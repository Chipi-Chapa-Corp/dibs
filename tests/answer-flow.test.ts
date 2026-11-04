import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {io,Socket} from 'socket.io-client';
import {act,addPlayer,createGame,joinMember,tick,view} from '../server/engine.ts';
import {openGameStore} from '../server/storage.ts';
import {startServer} from '../server/index.ts';
import {demoRounds} from '../shared/model.ts';
import {startReadyGame} from './helpers.ts';

function fixture(settings:Record<string,unknown>={}){
 const game=createGame({definition:{rounds:demoRounds(),settings:{earlyPenaltyMs:0,...settings}}}),red=addPlayer(game,'Red'),blue=addPlayer(game,'Blue'),green=addPlayer(game,'Green');
 startReadyGame(game);const q=game.rounds[0].categories[0].questions[0];act(game,'openQuestion',{questionId:q.id});
 const decision=(correct:boolean,points?:number)=>({questionId:q.id,playerId:game.current?.answeringId,answerToken:game.current?.answerToken,correct,...points===undefined?{}:{points}});
 return{game,red,blue,green,q,decision};
}

test('selecting a question opens buzzers after its cue and the first buzz locks everyone else out',()=>{
 const{game,red,blue,q}=fixture();act(game,'undo');act(game,'selectQuestion',{questionId:q.id},'host',null,1000);
 assert.equal(view(game,'host').current,null);assert.throws(()=>act(game,'buzz',{},'player',red.id));tick(game,1800);assert(game.current?.buzzOpen);
 act(game,'buzz',{},'player',red.id);assert.equal(game.current?.answeringId,red.id);assert(!game.current?.buzzOpen);assert(game.current?.answerToken);
 assert.throws(()=>act(game,'buzz',{},'player',blue.id));assert.equal(blue.blockedUntil,0);assert.equal(game.current?.buzzes.length,1);
});

test('the normal penalty reopens buzzing; Correct reveals the answer and waits for Continue',()=>{
 const{game,red,blue,q,decision}=fixture();act(game,'buzz',{},'player',red.id);
 act(game,'resolveAnswer',decision(false));assert.equal(red.score,-100);assert.equal(game.current?.answeringId,null);assert(game.current?.buzzOpen);assert(game.current?.attempted.includes(red.id));
 assert.throws(()=>act(game,'buzz',{},'player',red.id));act(game,'buzz',{},'player',blue.id);
 act(game,'resolveAnswer',decision(true),'host',null,1000);assert.equal(game.players[1].score,100);assert(game.current?.closed);assert(!game.current?.buzzOpen);assert(!game.played.includes(q.id));
 assert.equal(game.current?.revealAt,1900);assert.equal(view(game,'stage').currentQuestion?.answer,'');
 assert.throws(()=>act(game,'continueQuestion',{questionId:q.id},'host',null,1100),/Wait until the answer/);
 assert.throws(()=>act(game,'buzz',{},'player',red.id));tick(game,1900);assert.equal(view(game,'stage').currentQuestion?.answer,q.answer);
 tick(game,100000);assert.equal(game.current?.questionId,q.id);assert.throws(()=>act(game,'buzz',{},'player',red.id));
 act(game,'continueQuestion',{questionId:q.id});assert.equal(game.current,null);assert(game.played.includes(q.id));assert.equal(game.players[0].stats.incorrect,1);assert.equal(game.players[1].stats.correct,1);
});

test('Pass changes no score or answer stats, releases buzzing and sits the team out for this question',()=>{
 const{game,red,blue,decision}=fixture({revealDelayMs:0});act(game,'buzz',{},'player',red.id);
 act(game,'resolveAnswer',{...decision(false),result:'pass'});assert.equal(red.score,0);assert.equal(red.stats.incorrect,0);assert.equal(red.stats.correct,0);
 assert.equal(game.current?.answeringId,null);assert(game.current?.buzzOpen);assert(game.current?.attempted.includes(red.id));
 assert.throws(()=>act(game,'buzz',{},'player',red.id));
 const stage=view(game,'stage');assert.deepEqual(stage.current?.passedTeamIds,[red.id]);assert.deepEqual(stage.current?.incorrectTeamIds,[]);
 act(game,'buzz',{},'player',blue.id);act(game,'resolveAnswer',decision(true));assert.equal(game.players[1].score,100);
 act(game,'continueQuestion',{questionId:game.current!.questionId});
 const next=game.rounds[0].categories[0].questions[1];act(game,'openQuestion',{questionId:next.id});
 assert.deepEqual(view(game,'stage').current?.incorrectTeamIds,[]);assert.deepEqual(view(game,'stage').current?.passedTeamIds,[]);
 act(game,'buzz',{},'player',red.id);assert.equal(game.current?.answeringId,red.id);
});

test('decision nonces prevent double scoring and stale decisions from judging another team',()=>{
 const{game,red,blue,decision}=fixture();act(game,'buzz',{},'player',red.id);const first=decision(false);
 act(game,'resolveAnswer',first);act(game,'buzz',{},'player',blue.id);const token=game.current!.answerToken;
 assert.throws(()=>act(game,'resolveAnswer',first),/no longer answering/);assert.equal(game.current?.answeringId,blue.id);assert.equal(game.current?.answerToken,token);assert.equal(game.players[0].score,-100);
 const second={...decision(true),answerToken:token};act(game,'resolveAnswer',second);assert.throws(()=>act(game,'resolveAnswer',second),/No active answer/);assert.equal(game.players[1].score,100);
});

test('only the host can judge the active team and per-answer score overrides are rejected',()=>{
 const{game,red,blue,decision}=fixture();assert.throws(()=>act(game,'resolveAnswer',decision(true)),/no longer answering/);
 act(game,'buzz',{},'player',red.id);const before=structuredClone(game),correct=decision(true);
 assert.throws(()=>act(game,'resolveAnswer',correct,'player',red.id),/Host access/);
 for(const bad of [{...correct,playerId:blue.id},{...correct,answerToken:'old'}])assert.throws(()=>act(game,'resolveAnswer',bad),/no longer answering/);
 assert.throws(()=>act(game,'resolveAnswer',{...correct,questionId:'old'}),/no longer active/);
 for(const points of [-1,Infinity,NaN,1.5,10000001,'25'])assert.throws(()=>act(game,'resolveAnswer',{...correct,points}),/team controls/);
 assert.throws(()=>act(game,'resolveAnswer',{...decision(false),points:25}),/team controls/);assert.deepEqual(game,before);
 act(game,'pause');assert.throws(()=>act(game,'resolveAnswer',correct),/No active answer/);
});

test('an active answer and its nonce survive restart; retired queued buzzes are discarded',()=>{
 const{game,red,blue,decision}=fixture();act(game,'buzz',{},'player',red.id);const answer=decision(false);
 game.current!.buzzes.push({playerId:blue.id,at:Date.now(),order:2});game.settings.buzzMode='queue';
 const dir=mkdtempSync(join(tmpdir(),'dibs-active-answer-'));
 try{
  openGameStore(dir).save(game);const restored=openGameStore(dir).games.get(game.id)!;
  assert.equal(restored.current?.answerToken,answer.answerToken);assert.deepEqual(restored.current?.buzzes.map(b=>b.playerId),[red.id]);assert.equal(restored.settings.buzzMode,'first');
  act(restored,'resolveAnswer',answer);assert.equal(restored.players[0].score,-100);assert(restored.current?.buzzOpen);
  assert(!('answerToken' in view(restored,'player',red.id).current!));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

const emit=(s:Socket,event:string,data:unknown)=>new Promise<{ok:boolean;error?:string}>((resolve,reject)=>s.timeout(3000).emit(event,data,(e:Error|null,result:{ok:boolean;error?:string})=>e?reject(e):resolve(result)));
test('real phones race for the answer and can pass without being marked incorrect', {timeout:10000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dibs-answer-clients-')),server=await startServer({port:0,dataDir:dir,dev:false,quiet:true}),sockets:Socket[]=[];
 try{
  const{game,red,blue,green,q}=fixture({revealDelayMs:0});server.games.set(game.id,game);const alice=joinMember(game,{teamId:red.id,name:'Alice'}),bob=joinMember(game,{teamId:blue.id,name:'Bob'}),charlie=joinMember(game,{teamId:green.id,name:'Charlie'});
  const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
  const connect=async(role:string,token?:string)=>{
   const s=io(base,{autoConnect:false,transports:['websocket'],reconnection:false});sockets.push(s);let state:ReturnType<typeof view>;
   s.on('state',value=>state=value);await new Promise<void>((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);s.connect();});assert((await emit(s,'subscribe',{gameId:game.id,role,token})).ok);return{s,state:()=>state!};
  };
  const host=await connect('host'),a=await connect('player',alice.token),b=await connect('player',bob.token),stage=await connect('stage'),third=await connect('player',charlie.token);
  const race=await Promise.all([emit(a.s,'command',{action:'buzz'}),emit(b.s,'command',{action:'buzz'})]);assert.equal(race.filter(v=>v.ok).length,1);
  const answering=host.state().current!,loser=answering.answeringId===red.id?b:a;
  assert(!('answerToken' in a.state().current!));const first={questionId:q.id,playerId:answering.answeringId,answerToken:answering.answerToken,result:'incorrect'};
  assert((await emit(host.s,'command',{action:'resolveAnswer',data:first})).ok);assert.equal(game.players.find(t=>t.id===first.playerId)?.score,-100);assert(game.current?.buzzOpen);
  assert((await emit(loser.s,'command',{action:'buzz'})).ok);assert.equal((await emit(host.s,'command',{action:'resolveAnswer',data:first})).ok,false);
  const passed=host.state().current!;assert((await emit(host.s,'command',{action:'resolveAnswer',data:{questionId:q.id,playerId:passed.answeringId,answerToken:passed.answerToken,result:'pass'}})).ok);
  assert.equal(game.players.find(t=>t.id===passed.answeringId)?.score,0);assert.deepEqual(view(game,'stage').current?.incorrectTeamIds,[first.playerId]);assert.deepEqual(view(game,'stage').current?.passedTeamIds,[passed.answeringId]);
  assert((await emit(third.s,'command',{action:'buzz'})).ok);const next=host.state().current!;
  const stageReveal=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Stage did not reveal the answer')),3000);const changed=(v:ReturnType<typeof view>)=>{if(v.current?.revealed){clearTimeout(timer);stage.s.off('state',changed);resolve();}};stage.s.on('state',changed);});
  assert((await emit(host.s,'command',{action:'resolveAnswer',data:{questionId:q.id,playerId:next.answeringId,answerToken:next.answerToken,result:'correct'}})).ok);await stageReveal;
  assert.equal(stage.state().currentQuestion?.answer,q.answer);assert.equal(host.state().current?.questionId,q.id);assert(!game.played.includes(q.id));
  const stageBoard=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Stage did not return to board')),3000);const changed=(v:ReturnType<typeof view>)=>{if(v.current===null){clearTimeout(timer);stage.s.off('state',changed);resolve();}};stage.s.on('state',changed);});
  assert((await emit(host.s,'command',{action:'continueQuestion',data:{questionId:q.id}})).ok);await stageBoard;
  assert.equal(host.state().current,null);assert.equal(stage.state().current,null);assert(game.played.includes(q.id));assert.equal(game.players.find(t=>t.id===next.answeringId)?.score,100);
 }finally{sockets.forEach(s=>s.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});

test('incorrect and passed markers survive restart and clear when the question ends',()=>{
 const{game,red,blue,q,decision}=fixture();act(game,'buzz',{},'player',red.id);act(game,'resolveAnswer',decision(false));
 act(game,'buzz',{},'player',blue.id);act(game,'resolveAnswer',{...decision(false),result:'pass'});
 const dir=mkdtempSync(join(tmpdir(),'dibs-attempt-markers-'));
 try{
  openGameStore(dir).save(game);const restored=openGameStore(dir).games.get(game.id)!;
  const stage=view(restored,'stage');assert.deepEqual(stage.current?.incorrectTeamIds,[red.id]);assert.deepEqual(stage.current?.passedTeamIds,[blue.id]);assert(!stage.current?.judgments);assert.equal(stage.currentQuestion?.answer,'');
  act(restored,'closeQuestion');assert.equal(view(restored,'stage').current,null);
  const next=restored.rounds[0].categories[0].questions[1];act(restored,'openQuestion',{questionId:next.id});assert.deepEqual(view(restored,'stage').current?.incorrectTeamIds,[]);assert.deepEqual(view(restored,'stage').current?.passedTeamIds,[]);assert(restored.played.includes(q.id));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a correct answer keeps its reveal and scores through restart until the host continues',()=>{
 const{game,red,q,decision}=fixture();act(game,'buzz',{},'player',red.id);act(game,'resolveAnswer',decision(true),'host',null,1000);
 const dir=mkdtempSync(join(tmpdir(),'dibs-correct-reveal-'));
 try{
  const store=openGameStore(dir);store.save(game);const restored=openGameStore(dir).games.get(game.id)!;
  assert.equal(restored.current?.questionId,q.id);assert.equal(restored.current?.revealAt,1900);assert(!restored.current?.buzzOpen);assert.equal(restored.players[0].score,100);
  tick(restored,1900);store.save(restored);const visible=openGameStore(dir).games.get(game.id)!;
  assert.equal(view(visible,'stage').currentQuestion?.answer,q.answer);assert.equal(visible.players[0].score,100);assert.equal(visible.players[0].stats.correct,1);
  act(visible,'continueQuestion',{questionId:q.id});assert.equal(visible.current,null);assert(visible.played.includes(q.id));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

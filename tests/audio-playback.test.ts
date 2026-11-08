import test from 'node:test';
import assert from 'node:assert/strict';
import {act,addPlayer,createGame,view} from '../server/engine';
import {demoRounds} from '../shared/model';
import type {PresenterSettings} from '../shared/model';
import {applyMediaRequest,waveformPoints} from '../src/media-playback';
import {startReadyGame} from './helpers';

function mediaFixture(){
  let position=3,seeks=0,plays=0;
  const media={paused:true,ended:false,
    get currentTime(){return position;},set currentTime(value:number){position=value;seeks++;if(value===0)this.ended=false;},
    play(){this.paused=false;plays++;return Promise.resolve();},pause(){this.paused=true;}};
  return{media,counts:()=>({seeks,plays})};
}
const settings=(command:number,reset:number,playing:boolean):PresenterSettings=>({fullscreen:false,sound:true,mediaPlaying:playing,mediaCommandVersion:command,mediaResetVersion:reset,version:command});

test('Start plays, Stop rewinds once, and Restart rewinds and plays even during playback',()=>{
  const{media,counts}=mediaFixture();
  let state=applyMediaRequest(media,settings(1,0,true),true,{command:0,reset:0,play:false}).request;
  assert.equal(media.currentTime,3);assert.equal(counts().plays,1);
  state=applyMediaRequest(media,settings(2,1,false),false,state).request;
  assert(media.paused);assert.equal(media.currentTime,0);assert.equal(counts().seeks,1);
  state=applyMediaRequest(media,settings(2,1,false),false,state).request;assert.equal(counts().seeks,1);
  media.currentTime=4;state=applyMediaRequest(media,settings(3,2,true),true,state).request;
  assert.equal(media.currentTime,0);assert(!media.paused);assert.equal(counts().plays,2);
  media.currentTime=2;applyMediaRequest(media,settings(4,3,true),true,state);
  assert.equal(media.currentTime,0);assert.equal(counts().plays,3);
});

test('finished audio stays finished through screen updates; an explicit Start can play it again',()=>{
  const{media,counts}=mediaFixture();media.ended=true;media.currentTime=8;
  const previous={command:1,reset:0,play:true};
  applyMediaRequest(media,settings(1,0,true),true,previous);
  applyMediaRequest(media,{...settings(1,0,true),sound:false,version:99},true,previous);
  assert.equal(counts().plays,0);assert.equal(media.currentTime,8);
  applyMediaRequest(media,settings(2,0,true),true,previous);
  assert.equal(media.currentTime,0);assert.equal(counts().plays,1);
});

test('game pause and resume preserve audio position',()=>{
  const{media,counts}=mediaFixture();media.paused=false;
  const request=applyMediaRequest(media,settings(1,0,true),false,{command:1,reset:0,play:true}).request;
  assert(media.paused);assert.equal(media.currentTime,3);
  applyMediaRequest(media,settings(1,0,true),true,request);
  assert(!media.paused);assert.equal(media.currentTime,3);assert.equal(counts().seeks,0);
});

test('the displayed waveform follows its samples, stays bounded, and is flat for silence',()=>{
  const silence=waveformPoints(new Float32Array(1024),900,180);
  assert(silence.every(point=>point.y===90));
  const samples=Float32Array.from({length:1024},(_,i)=>Math.sin(i*.05)*.4);
  const wave=waveformPoints(samples,900,180);
  assert(wave.some(point=>Math.abs(point.y-90)>20));
  assert(wave.every(point=>point.y>=0&&point.y<=180));
  assert.equal(wave[0].y,90);assert(Math.abs(wave.at(-1)!.y-90)<.001);
  assert.deepEqual(wave,waveformPoints(samples,900,180));
});

test('only the host can start/stop/restart the active audio, without changing scores or the buzz clock',()=>{
  const g=createGame({definition:{rounds:demoRounds()}}),team=addPlayer(g,'Red');startReadyGame(g);
  const q=g.rounds[0].categories[0].questions[0];act(g,'openQuestion',{questionId:q.id});
  const current=structuredClone(g.current),input={questionId:q.id,source:'/sound.mp3',operation:'start'};
  assert.throws(()=>act(g,'controlPresenterMedia',input,'player',team.id),/Host access/);
  assert.throws(()=>act(g,'controlPresenterMedia',{...input,questionId:'stale'}),/no longer active/);
  assert.throws(()=>act(g,'controlPresenterMedia',{...input,operation:'seek'}),/Start, Stop or Restart/);
  act(g,'controlPresenterMedia',input);assert(g.presenter?.mediaPlaying&&g.presenter.sound);
  assert.equal(g.presenter.mediaSource,'/sound.mp3');assert.equal(view(g,'stage').presenter?.mediaCommandVersion,1);
  act(g,'controlPresenterMedia',{...input,operation:'stop'});assert(!g.presenter.mediaPlaying);assert.equal(g.presenter.mediaResetVersion,1);
  act(g,'controlPresenterMedia',{...input,operation:'restart'});assert(g.presenter.mediaPlaying);assert.equal(g.presenter.mediaResetVersion,2);
  assert.deepEqual(g.current,current);assert.equal(team.score,0);
  act(g,'pause');assert.throws(()=>act(g,'controlPresenterMedia',input),/Resume/);
  assert.doesNotThrow(()=>act(g,'controlPresenterMedia',{...input,operation:'stop'}));
});

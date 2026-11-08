import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {io,Socket} from 'socket.io-client';
import {act,addPlayer,createGame,joinMember,view} from '../server/engine';
import {startServer} from '../server/index';
import {openGameStore} from '../server/storage';
import {demoRounds} from '../shared/model';
import type {GameView,PresenterStatus} from '../shared/model';
import {startReadyGame} from './helpers';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Markdown from '../src/Markdown';
import {ReadOnlyPresenter} from '../src/presenter-context';

test('presenter Markdown has no clickable links, autoplay or native media controls; host previews retain controls',()=>{
  const text='[Reference](https://example.com)\n\n<video controls autoplay src="/clip.mp4"></video>\n\n<audio controls autoplay src="/clip.mp3"></audio>';
  const display=renderToStaticMarkup(createElement(ReadOnlyPresenter.Provider,{value:true},createElement(Markdown,{text})));
  assert.match(display,/<video/);assert.match(display,/<audio/);assert.match(display,/Reference/);
  assert.doesNotMatch(display,/<a\s|\scontrols[=\s>]|\sautoPlay[=\s>]/i);
  const host=renderToStaticMarkup(createElement(Markdown,{text}));
  assert.match(host,/<a\s/);assert.match(host,/\scontrols=/);
});

test('host display choices preserve gameplay, survive storage, and reset media on the next clue',()=>{
  const g=createGame({definition:{rounds:demoRounds()}}),team=addPlayer(g,'Red');startReadyGame(g);
  const q=g.rounds[0].categories[0].questions[0];act(g,'openQuestion',{questionId:q.id});
  const current=structuredClone(g.current),history=structuredClone(g.history);
  assert.throws(()=>act(g,'setPresenter',{sound:true},'player',team.id),/Host access/);
  assert.throws(()=>act(g,'setPresenter',{fullscreen:'yes'}),/on or off/);
  act(g,'setPresenter',{fullscreen:true,sound:true,mediaPlaying:true});
  assert.deepEqual(g.current,current);assert.deepEqual(g.history,history);
  assert.equal(view(g,'stage').presenter?.sound,true);
  const version=g.presenter!.version;
  act(g,'setPresenter',{fullscreen:true});assert(g.presenter!.version>version,'same-value requests can be retried');
  const dir=mkdtempSync(join(tmpdir(),'dibs-presenter-store-'));
  try{openGameStore(dir).save(g);assert.deepEqual(openGameStore(dir).games.get(g.id)!.presenter,g.presenter);}finally{rmSync(dir,{recursive:true,force:true});}
  act(g,'closeQuestion');act(g,'openQuestion',{questionId:g.rounds[0].categories[0].questions[1].id});
  assert.equal(g.presenter?.mediaPlaying,false);assert.equal(g.presenter?.sound,true);assert.equal(g.presenter?.fullscreen,true);
  act(g,'setPresenter',{sound:false,fullscreen:false});const settings=structuredClone(g.presenter);
  act(g,'undo');assert.deepEqual(g.presenter,settings,'undoing a question must preserve current display choices');
});

test('only the host skips results; every display receives the choice and the next finish starts fresh',()=>{
  const g=createGame({definition:{rounds:demoRounds()}}),team=addPlayer(g,'Red');startReadyGame(g);
  assert.throws(()=>act(g,'skipResults'),/Finish the game/);act(g,'finish');
  assert.throws(()=>act(g,'skipResults',{},'player',team.id),/Host access/);
  act(g,'skipResults');assert(view(g,'stage').resultsSkipped);assert(view(g,'player',team.id).resultsSkipped);
  act(g,'resume');act(g,'finish');assert(!g.resultsSkipped);
});

test('read-only presenters receive host requests and report status without changing game state',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dibs-presenter-network-'));
  const server=await startServer({port:0,dataDir:dir,dev:false,quiet:true}),sockets:Socket[]=[];
  const emit=(s:Socket,event:string,data:unknown)=>s.timeout(3000).emitWithAck(event,data);
  try{
    const game=createGame({definition:{rounds:demoRounds()}});server.games.set(game.id,game);
    const team=addPlayer(game,'Red'),member=joinMember(game,{name:'Alice',teamId:team.id});startReadyGame(game);
    const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
    const connect=async(role:string,token?:string)=>{
      const s=io(base,{transports:['websocket'],autoConnect:false});sockets.push(s);let latest:GameView|null=null;
      s.on('state',value=>latest=value);await new Promise<void>(resolve=>{s.once('connect',()=>resolve());s.connect();});
      assert((await emit(s,'subscribe',{gameId:game.id,role,token})).ok);
      return{s,state:()=>latest!};
    };
    const host=await connect('host');let statuses:PresenterStatus[]=[];host.s.on('presenterStatus',value=>statuses=value);
    const stage=await connect('stage'),player=await connect('player',member.token);
    const status=(predicate:(items:PresenterStatus[])=>boolean)=>new Promise<void>((resolve,reject)=>{
      if(predicate(statuses)){resolve();return;}
      const timeout=setTimeout(()=>{host.s.off('presenterStatus',changed);reject(Error('Display status did not arrive'));},3000);
      const changed=(items:PresenterStatus[])=>{if(predicate(items)){clearTimeout(timeout);host.s.off('presenterStatus',changed);resolve();}};
      host.s.on('presenterStatus',changed);
    });
    const request={action:'setPresenter',data:{fullscreen:true,sound:true}};
    assert.equal((await emit(stage.s,'command',request)).ok,false);
    assert.equal((await emit(player.s,'command',request)).ok,false);
    assert.equal((await emit(host.s,'command',request)).ok,true);
    await new Promise<void>(resolve=>{if(stage.state().presenter?.sound)resolve();else stage.s.once('state',()=>resolve());});
    assert.equal(stage.state().presenter?.fullscreen,true);assert.equal(stage.state().presenter?.sound,true);
    const revision=game.revision;
    assert.equal((await emit(player.s,'presenterStatus',{fullscreen:true,sound:true})).ok,false);
    assert.equal((await emit(stage.s,'presenterStatus',{fullscreen:false,sound:false,fullscreenError:'Browser blocked fullscreen'})).ok,true);
    await status(items=>items.length===1&&items[0].fullscreenError==='Browser blocked fullscreen');
    assert.equal(game.revision,revision,'display feedback must not mutate or save gameplay');
    assert.equal((await emit(stage.s,'presenterStatus',{fullscreen:true,sound:true})).ok,true);
    await status(items=>items[0]?.fullscreen===true&&!items[0].fullscreenError);
    stage.s.disconnect();await status(items=>items.length===0);
    const reconnected=await connect('stage');assert.equal(reconnected.state().presenter?.sound,true);
    await status(items=>items.length===1&&items[0].id===reconnected.s.id);
  }finally{sockets.forEach(s=>s.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});

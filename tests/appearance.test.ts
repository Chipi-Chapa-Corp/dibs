import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGame,act,view} from '../server/engine';
import {openGameStore} from '../server/storage';
import {defaultTheme,demoRounds} from '../shared/model';
import {presenterTheme,pruneThemeOverrides,themeForRound} from '../shared/appearance';
import {appearancePreviews} from '../src/appearance-previews';
import {startServer} from '../server/index';

test('rounds inherit shared settings and store only valid, distinct overrides',()=>{
  const own=pruneThemeOverrides(defaultTheme,{accent:'#112233',paper:defaultTheme.paper,background:'',motion:false,sound:false,title:'Hidden',unknown:'value'});
  assert.deepEqual(own,{accent:'#112233'});
  assert.deepEqual(pruneThemeOverrides(defaultTheme,{accent:'red',background:'javascript:alert(1)',displayFont:'anything'}),{});
  const inherited=themeForRound({...defaultTheme,motion:false,sound:false,title:'Old title'},own);
  assert.equal(inherited.accent,'#112233');assert.equal(inherited.paper,defaultTheme.paper);
  assert(inherited.motion&&inherited.sound);assert.equal(inherited.title,'');
  const game=createGame({definition:{rounds:demoRounds()}});game.rounds[0].theme={accent:'#112233'};
  assert.equal(presenterTheme(game).accent,game.theme.accent,'the lobby uses Shared');
  game.status='playing';assert.equal(presenterTheme(game).accent,'#112233');
  game.status='finished';assert.equal(presenterTheme(game).accent,'#112233');
});

test('shared changes propagate; overrides and per-field reverts survive saving, reordering, storage and export/import',()=>{
  const rounds=demoRounds();rounds[1].theme={accent:'#112233',displayFont:'sans'};
  const g=createGame({definition:{rounds}}),roundId=g.rounds[1].id;
  act(g,'save',{theme:{paper:'#010203',accent:'#abcdef'}});
  assert.equal(themeForRound(g.theme,g.rounds[0].theme).paper,'#010203');
  assert.equal(themeForRound(g.theme,g.rounds[1].theme).accent,'#112233');
  const reordered=[g.rounds[1],g.rounds[0],g.rounds[2]];act(g,'save',{rounds:reordered});
  assert.equal(g.rounds[0].id,roundId);assert.deepEqual(g.rounds[0].theme,{accent:'#112233',displayFont:'sans'});
  const dir=mkdtempSync(join(tmpdir(),'dibs-appearance-'));
  try{
    openGameStore(dir).save(g);const restored=openGameStore(dir).games.get(g.id)!;
    assert.deepEqual(restored.rounds[0].theme,g.rounds[0].theme);
    const copy=createGame({definition:{rounds:restored.rounds,theme:restored.theme}});
    assert.deepEqual(copy.rounds[0].theme,g.rounds[0].theme);
    const reverted=structuredClone(copy.rounds);delete reverted[0].theme!.accent;
    act(copy,'save',{rounds:reverted});assert.equal(themeForRound(copy.theme,copy.rounds[0].theme).accent,'#abcdef');
    assert.equal(themeForRound(copy.theme,copy.rounds[0].theme).displayFont,'sans');
    act(copy,'save',{theme:{displayFont:'sans'}});assert.equal(copy.rounds[0].theme,undefined,'redundant overrides become inherited');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('appearance edits preserve clues and imports cannot hide unsafe values in round themes',()=>{
  const rounds=demoRounds();rounds[0].theme={background:'javascript:alert(1)',accent:'#ff6600',motion:false}as never;
  const g=createGame({definition:{rounds}}),before=structuredClone(g.rounds[0].categories);
  assert.deepEqual(g.rounds[0].theme,{accent:'#ff6600'});
  act(g,'save',{theme:{accent:'#ff6600'}});assert.equal(g.rounds[0].theme,undefined);
  assert.deepEqual(g.rounds[0].categories,before);
});

test('the gallery covers real presenter states for each round without changing game data',()=>{
  const rounds=demoRounds();rounds[0].theme={paper:'#010203'};
  rounds[0].categories[0].questions[0].prompt='![Photo](/test-board/picture-1.jpg)';
  rounds[0].categories[0].questions[0].slowReveal=true;
  rounds[0].categories[0].questions[1].dailyDouble=true;
  rounds[0].categories[1].questions[0].modifier={title:'Mystery',instructions:'Swap scores'};
  const g=createGame({definition:{rounds}}),editor=view(g,'host'),before=structuredClone(editor);
  const all=appearancePreviews(editor,null),board=appearancePreviews(editor,rounds[0].id),final=appearancePreviews(editor,rounds[2].id);
  assert(all.some(s=>s.id==='lobby'));
  for(const kind of ['board','selection','question','picture','buzz','incorrect','answer-reveal','answer','image-reveal','double','double-question','modifier','modifier-claimed','paused','countdown','places','winner'])assert(board.some(s=>s.id.endsWith(':'+kind)),kind);
  for(const kind of ['wagers','final-question','answers-locked','final-answer','countdown','winner'])assert(final.some(s=>s.id.endsWith(':'+kind)),kind);
  assert(board.every(s=>s.game.roundIndex===0&&s.game.role==='stage'));
  assert.equal(board.find(s=>s.id.endsWith(':picture'))?.game.currentQuestion?.prompt,rounds[0].categories[0].questions[0].prompt);
  assert.equal(themeForRound(board[0].game.theme,board[0].game.rounds[0].theme).paper,'#010203');
  assert.deepEqual(editor,before);
});

test('export retains round overrides without allowing external framing',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dibs-appearance-network-'));
  const server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});
  try{
    const rounds=demoRounds();rounds[0].theme={accent:'#334455'};
    const game=createGame({definition:{rounds}});server.games.set(game.id,game);
    const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
    const exported=await(await fetch(`${base}/api/games/${game.id}/export`)).json();
    assert.deepEqual(exported.rounds[0].theme,{accent:'#334455'});
    const preview=await fetch(base+'/presenter-preview');
    assert.equal(preview.headers.get('x-frame-options'),'DENY');assert.match(preview.headers.get('content-security-policy')!,/frame-ancestors 'none'/);
    await preview.text();
    const ordinary=await fetch(base+'/');assert.equal(ordinary.headers.get('x-frame-options'),'DENY');await ordinary.text();
  }finally{await server.close();rmSync(dir,{recursive:true,force:true});}
});

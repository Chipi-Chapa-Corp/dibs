import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openGameStore} from '../server/storage.ts';
import {createGame,addPlayer,act,tick,view} from '../server/engine.ts';
import {demoRounds} from '../shared/model.ts';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'dibs-storage-')),directory=join(dir,'games');mkdirSync(directory);
 const warnings:string[]=[];
 return {dir,directory,warnings,load:()=>openGameStore(dir,message=>warnings.push(message)),remove:()=>rmSync(dir,{recursive:true,force:true})};
}
const write=(file:string,data:unknown)=>writeFileSync(file,JSON.stringify(data));
const read=(file:string)=>JSON.parse(readFileSync(file,'utf8'));

test('each new game gets its own JSON file and saving one leaves the others untouched',()=>{
 const f=fixture();
 try{
  const store=f.load(),a=createGame({name:'First'}),b=createGame({name:'Second'});
  store.save(a);store.save(b);
  const aPath=join(f.directory,`${a.id}.json`),before=readFileSync(aPath,'utf8');
  b.name='Edited second';store.save(b);
  assert.deepEqual(readdirSync(f.directory).sort(),[`${a.id}.json`,`${b.id}.json`].sort());
  assert.equal(readFileSync(aPath,'utf8'),before);assert.equal(read(join(f.directory,`${b.id}.json`)).name,'Edited second');
  assert.equal(f.load().games.size,2);assert(!existsSync(join(f.dir,'games.json')));
 }finally{f.remove();}
});
test('a dropped export loads in place once with stable identity and claimable host access',()=>{
 const f=fixture();
 try{
  const file=join(f.directory,'my-board.json');write(file,{format:'jeopardy/1',name:'Dropped board',rounds:demoRounds()});
  const first=f.load(),game=[...first.games.values()][0];
  assert.equal(game.name,'Dropped board');assert.equal(game.hostClaimable,true);
  assert.deepEqual(readdirSync(f.directory),['my-board.json']);
  assert.equal(read(file).format,'jeopardy/state/1');assert.equal(read(file).hostToken,game.hostToken);
  game.name='Edited board';first.save(game);
  const restored=f.load().games.get(game.id)!;
  assert.equal(restored.name,'Edited board');assert.equal(restored.hostToken,game.hostToken);assert.equal(restored.hostClaimable,true);
  assert.deepEqual(readdirSync(f.directory),['my-board.json']);
 }finally{f.remove();}
});
test('migration preserves IDs, access keys, scores and active progress and archives the combined file',()=>{
 const f=fixture();
 try{
  const a=createGame({name:'Existing A',definition:{rounds:demoRounds()}}),b=createGame({name:'Existing B'}),player=addPlayer(a,'Ada');
  player.score=800;act(a,'start');act(a,'openQuestion',{questionId:a.rounds[0].categories[0].questions[0].id});
  const active=structuredClone(a.current);write(join(f.dir,'games.json'),[a,b]);
  const store=f.load(),restored=store.games.get(a.id)!;
  assert.equal(store.games.size,2);assert.equal(restored.hostToken,a.hostToken);assert.equal(restored.players[0].token,player.token);assert.equal(restored.players[0].score,800);assert.deepEqual(restored.current,active);
  assert.equal(restored.hostClaimable,false);assert(!existsSync(join(f.dir,'games.json')));
  assert.deepEqual(read(join(f.dir,'games.json.migrated')),[JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b))]);
  assert.deepEqual(readdirSync(f.directory).sort(),[`${a.id}.json`,`${b.id}.json`].sort());
  assert.equal(f.load().games.size,2);
 }finally{f.remove();}
});
test('an existing per-game file takes precedence over a stale legacy copy',()=>{
 const f=fixture();
 try{
  const game=createGame({name:'Old name'});write(join(f.dir,'games.json'),[game]);
  game.name='Latest name';write(join(f.directory,`${game.id}.json`),game);
  const store=f.load();assert.equal(store.games.size,1);assert.equal(store.games.get(game.id)!.name,'Latest name');assert.equal(read(join(f.directory,`${game.id}.json`)).name,'Latest name');
  assert(existsSync(join(f.dir,'games.json.migrated')));
 }finally{f.remove();}
});
test('malformed, duplicate and temporary files do not prevent other games loading or get overwritten',()=>{
 const f=fixture();
 try{
  const game=createGame({name:'Good'});
  write(join(f.directory,'a.json'),game);write(join(f.directory,'duplicate.json'),game);
  writeFileSync(join(f.directory,'broken.json'),'{ broken');write(join(f.directory,'partial.json.tmp'),game);
  mkdirSync(join(f.directory,'folder.json'));write(join(f.directory,'not-a-game.json'),{name:'Missing rounds'});
  const store=f.load();assert.equal(store.games.size,1);assert.equal(f.warnings.length,3);
  game.name='Saved';store.save(game);
  assert.equal(readFileSync(join(f.directory,'broken.json'),'utf8'),'{ broken');assert.equal(read(join(f.directory,'duplicate.json')).name,'Good');
  assert.equal(read(join(f.directory,'a.json')).name,'Saved');
 }finally{f.remove();}
});
test('a partial migration keeps the original file and does not overwrite recovered progress on retry',()=>{
 const f=fixture();
 try{
  const game=createGame({name:'Legacy'});write(join(f.dir,'games.json'),[game,{broken:true}]);
  const first=f.load();assert.equal(first.games.size,1);assert(existsSync(join(f.dir,'games.json')));assert(!existsSync(join(f.dir,'games.json.migrated')));
  const restored=first.games.get(game.id)!;restored.name='Updated';first.save(restored);
  const second=f.load();assert.equal(second.games.size,1);assert.equal(second.games.get(game.id)!.name,'Updated');
  assert(existsSync(join(f.dir,'games.json')));
 }finally{f.remove();}
});
test('invalid saved IDs are skipped and cannot escape the game directory when saved',()=>{
 const f=fixture();
 try{
  const game=createGame();game.id='../outside';write(join(f.directory,'unsafe.json'),game);
  const store=f.load();assert.equal(store.games.size,0);assert.throws(()=>store.save(game),/Invalid game ID/);assert(!existsSync(join(f.dir,'outside.json')));
 }finally{f.remove();}
});

test('the bundled sample is seeded only when the game directory is first created',()=>{
 const f=fixture();
 try{
  rmSync(f.directory,{recursive:true});
  const seed=join(f.dir,'sample-source.json');write(seed,{format:'jeopardy/1',name:'Bundled sample',rounds:demoRounds()});
  const store=openGameStore(f.dir,undefined,seed);assert.equal(store.games.size,1);assert.equal(read(join(f.directory,'test-game.json')).name,'Bundled sample');
  rmSync(join(f.directory,'test-game.json'));
  assert.equal(openGameStore(f.dir,undefined,seed).games.size,0);assert(!existsSync(join(f.directory,'test-game.json')));
 }finally{f.remove();}
});

test('loading and undoing older saves discards player-selection settings while preserving Daily Double answerers',()=>{
 const f=fixture();
 try{
  const game=createGame({definition:{rounds:demoRounds()}}),player=addPlayer(game,'Ada');player.score=500;
  const question=game.rounds[0].categories[0].questions[0];question.dailyDouble=true;
  act(game,'start');act(game,'openQuestion',{questionId:question.id,playerId:player.id});act(game,'adjust',{playerId:player.id,amount:1});
  const stored=JSON.parse(JSON.stringify(game));
  for(const snapshot of [stored,...stored.undo]){snapshot.settings.selection='winner';snapshot.chooserId=player.id;if(snapshot.current)snapshot.current.selectionPlayerId=player.id;}
  write(join(f.directory,'old-selection.json'),stored);
  const restored=f.load().games.get(game.id)!;
  assert(!('selection' in restored.settings));assert(!('chooserId' in restored));assert(!('selectionPlayerId' in restored.current!));assert.equal(restored.current?.answeringId,player.id);
  act(restored,'undo');
  assert(!('selection' in restored.settings));assert(!('chooserId' in restored));assert(!('selectionPlayerId' in restored.current!));assert.equal(restored.current?.answeringId,player.id);assert.equal(restored.players[0].score,500);
  assert.throws(()=>act(restored,'selectQuestion',{questionId:question.id},'player',player.id),/Host access/);
 }finally{f.remove();}
});

test('deleting a game removes only its JSON file and it stays gone after reopening the store',()=>{
 const f=fixture();
 try{
  const store=f.load(),a=createGame({name:'Delete me'}),b=createGame({name:'Keep me'});store.save(a);store.save(b);
  const otherFile=join(f.directory,`${b.id}.json`),before=readFileSync(otherFile,'utf8');
  store.remove(a.id);assert(!existsSync(join(f.directory,`${a.id}.json`)));assert.equal(readFileSync(otherFile,'utf8'),before);
  const restored=f.load();assert(!restored.games.has(a.id));assert(restored.games.has(b.id));assert.throws(()=>restored.remove(a.id),/not found/);
 }finally{f.remove();}
});
test('deleting a named, directory-loaded sample removes the original file and does not seed it again',()=>{
 const f=fixture();
 try{
  rmSync(f.directory,{recursive:true});const seed=join(f.dir,'seed.json');write(seed,{format:'jeopardy/1',name:'Sample',rounds:demoRounds()});
  const store=openGameStore(f.dir,undefined,seed),game=[...store.games.values()][0];
  assert(existsSync(join(f.directory,'test-game.json')));store.remove(game.id);
  assert(!existsSync(join(f.directory,'test-game.json')));assert.equal(store.games.size,0);assert.equal(openGameStore(f.dir,undefined,seed).games.size,0);
 }finally{f.remove();}
});
test('deleting a migrated game prevents an unfinished legacy migration from restoring it',()=>{
 const f=fixture();
 try{
  const game=createGame({name:'Delete migrated game'});write(join(f.dir,'games.json'),[game,{broken:true}]);
  const store=f.load();assert(store.games.has(game.id));store.remove(game.id);
  assert.deepEqual(read(join(f.dir,'games.json')),[{broken:true}]);assert(!existsSync(join(f.directory,`${game.id}.json`)));
  assert(!f.load().games.has(game.id));
 }finally{f.remove();}
});


test('legacy active countdowns are discarded on load and cannot return through undo or resaving',()=>{
 const f=fixture();
 try{
  const game=createGame({definition:{rounds:demoRounds()}}),player=addPlayer(game,'Ada');
  act(game,'start');act(game,'openQuestion',{questionId:game.rounds[0].categories[0].questions[0].id});act(game,'openBuzzers');
  act(game,'adjust',{playerId:player.id,amount:100});
  const stored=JSON.parse(JSON.stringify(game));
  for(const snapshot of [stored,...stored.undo]){
   Object.assign(snapshot.settings,{timerEnabled:true,questionSeconds:1,answerSeconds:1,finalSeconds:1,autoStartTimer:true,expiryAction:'reveal'});
   for(const r of snapshot.rounds)for(const c of r.categories)for(const q of c.questions)q.timer=1;
   if(snapshot.current)snapshot.current.timer={endsAt:1,remainingMs:0,durationMs:1000,paused:false};
  }
  const file=join(f.directory,'legacy-countdowns.json');write(file,stored);
  const store=f.load(),restored=store.games.get(game.id)!;
  assert(restored);assert.equal(restored.current?.questionId,game.current?.questionId);assert(restored.current?.buzzOpen);
  assert(!JSON.stringify(restored).includes('timer'));assert(!('finalSeconds' in restored.settings));
  act(restored,'undo');assert.equal(restored.players[0].score,0);assert(!JSON.stringify(restored).includes('timer'));
  act(restored,'buzz',{},'player',player.id,86400000);assert.equal(restored.current?.answeringId,player.id);
  store.save(restored);assert(!readFileSync(file,'utf8').includes('timer'));assert(!('timer' in f.load().games.get(game.id)!.current!));
 }finally{f.remove();}
});


test('a pending selection survives restart and opens once, while older saves default to no selection',()=>{
 const f=fixture();
 try{
  const game=createGame({definition:{rounds:demoRounds()}}),q=game.rounds[0].categories[0].questions[0];
  act(game,'start');act(game,'selectQuestion',{questionId:q.id},'host',null,1000);
  const store=f.load();store.save(game);
  const restored=f.load().games.get(game.id)!;
  assert.deepEqual(restored.selection,game.selection);assert.equal(restored.current,null);assert(!tick(restored,1799));assert(tick(restored,1800));assert.equal(view(restored,'host').current?.questionId,q.id);assert.equal(restored.questionCount,1);assert.equal(restored.selection,null);assert(!tick(restored,2000));
  const legacy=JSON.parse(JSON.stringify(restored));delete legacy.selection;for(const snapshot of legacy.undo)delete snapshot.selection;
  write(join(f.directory,`${game.id}.json`),legacy);const old=f.load().games.get(game.id)!;
  assert.equal(old.selection,null);act(old,'undo');assert.equal(old.selection,null);
 }finally{f.remove();}
});

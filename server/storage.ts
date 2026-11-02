import fs from 'node:fs';
import path from 'node:path';
import {createGame,normalizeStoredGameplay,updateDefinition} from './engine.ts';
import type {Game} from '../shared/model.ts';
import {isQuestionFilled} from '../shared/model.ts';

type RecordValue=Record<string,any>;
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Z0-9_-]{1,60}$/.test(value);
const object=(value:unknown):value is RecordValue=>!!value&&typeof value==='object'&&!Array.isArray(value);

function restore(value:unknown):Game{
  if(!object(value)||!validId(value.id)||typeof value.hostToken!=='string'||!value.hostToken||!Array.isArray(value.players)||!object(value.settings))throw new Error('Invalid saved game');
  if(value.format&&value.format!=='jeopardy/state/1')throw new Error('Unsupported saved game format');
  if(typeof value.name!=='string'||typeof value.subtitle!=='string'||!Number.isFinite(value.createdAt)||!object(value.theme))throw new Error('Invalid saved game metadata');
  if(!['lobby','playing','finished'].includes(value.status))throw new Error('Invalid game status');
  if(!Number.isInteger(value.roundIndex)||!Array.isArray(value.rounds)||value.roundIndex<0||value.roundIndex>=value.rounds.length)throw new Error('Invalid current round');
  if(!Array.isArray(value.played)||!Array.isArray(value.history)||!Array.isArray(value.undo))throw new Error('Invalid game history');
  for(const p of value.players)if(!object(p)||typeof p.id!=='string'||typeof p.token!=='string'||!Number.isFinite(p.score))throw new Error('Invalid saved player');
  if(value.current!==null&&(!object(value.current)||!object(value.current.wagers)||!Array.isArray(value.current.buzzes)||!Array.isArray(value.current.attempted)||!['question','wager','final','modifier'].includes(value.current.phase)))throw new Error('Invalid active question');
  if(value.selection!=null&&(!object(value.selection)||typeof value.selection.questionId!=='string'||!Number.isFinite(value.selection.opensAt)||value.current!==null))throw new Error('Invalid question selection');
  if(value.modifierClaims!==undefined&&!Array.isArray(value.modifierClaims))throw new Error('Invalid modifier reminders');
  const {format:_format,modifiers:_legacyModifiers,uses:_legacyUses,chooserId:_legacyChooserId,...stored}=value;
  const game=stored as Game;
  if(game.current){const {selectionPlayerId:_legacySelectionPlayer,...current}=game.current as Game['current']&RecordValue;game.current=current;}
  game.modifierClaims??=[];
  game.hostClaimable=game.hostClaimable===true;
  if(game.hostTransfer&&(!object(game.hostTransfer)||!/^[a-f0-9]{64}$/.test(game.hostTransfer.tokenHash)||!Number.isFinite(game.hostTransfer.expiresAt)))game.hostTransfer=null;
  normalizeStoredGameplay(game);
  for(const snapshot of game.undo)if(object(snapshot)&&object(snapshot.settings)&&Array.isArray(snapshot.rounds))normalizeStoredGameplay(snapshot as Game);
  updateDefinition(game,{rounds:game.rounds});
  if(game.selection){const question=game.rounds[game.roundIndex].categories.flatMap(c=>c.questions).find(q=>q.id===game.selection!.questionId);if(!question||!isQuestionFilled(question)||game.played.includes(question.id)||game.status!=='playing')throw new Error('Invalid selected question');}
  game.players.forEach(p=>p.connected=false);
  return game;
}

/** A file contains either an importable definition or a complete, private saved game. */
export function openGameStore(dataDir:string,warn:(message:string)=>void=console.warn,seedFile?:string){
  const directory=path.join(dataDir,'games');
  const firstRun=!fs.existsSync(directory);
  fs.mkdirSync(directory,{recursive:true});
  if(firstRun&&seedFile&&fs.existsSync(seedFile))fs.copyFileSync(seedFile,path.join(directory,'test-game.json'));
  const games=new Map<string,Game>(),files=new Map<string,string>();
  const save=(game:Game)=>{
    if(!validId(game.id))throw new Error('Invalid game ID');
    const file=files.get(game.id)||path.join(directory,`${game.id}.json`);
    if(!files.has(game.id)&&fs.existsSync(file))throw new Error(`Game file already exists: ${path.basename(file)}`);
    fs.writeFileSync(file+'.tmp',JSON.stringify({format:'jeopardy/state/1',...game},null,2)+'\n',{mode:0o600});
    fs.renameSync(file+'.tmp',file);
    files.set(game.id,file);
  };
  const add=(game:Game,file:string)=>{
    if(games.has(game.id))throw new Error(`Duplicate game ID ${game.id}`);
    games.set(game.id,game);files.set(game.id,file);
  };
  for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    if(!entry.isFile()||!entry.name.endsWith('.json'))continue;
    const file=path.join(directory,entry.name);
    let loaded:Game|undefined;
    try{
      const value:unknown=JSON.parse(fs.readFileSync(file,'utf8'));
      const definition=object(value)&&Array.isArray(value.rounds)&&!('hostToken' in value)&&((!value.format&&!('players' in value))||value.format==='jeopardy/1');
      const game=definition?createGame({name:value.name,definition:value}):restore(value);
      if(definition)game.hostClaimable=true;
      add(game,file);loaded=game;
      // Normalize definitions in place once, retaining the filename and stable access keys.
      if(definition)save(game);
    }catch(error){if(loaded){games.delete(loaded.id);files.delete(loaded.id);}warn(`[storage] Skipping ${file}: ${(error as Error).message}`);}
  }
  const legacy=path.join(dataDir,'games.json');
  if(fs.existsSync(legacy)){
    try{
      const stored:unknown=JSON.parse(fs.readFileSync(legacy,'utf8'));
      if(!Array.isArray(stored))throw new Error('Expected a game array');
      let complete=true;
      for(const value of stored){
        try{
          if(object(value)&&games.has(value.id))continue;
          const game=restore(value);
          save(game);games.set(game.id,game);
        }catch(error){complete=false;warn(`[storage] Could not migrate a game from ${legacy}: ${(error as Error).message}`);}
      }
      if(complete){
        let archive=legacy+'.migrated';
        if(fs.existsSync(archive))archive+=`.${Date.now()}`;
        fs.renameSync(legacy,archive);
      }
    }catch(error){warn(`[storage] Could not migrate ${legacy}: ${(error as Error).message}`);}
  }
  const remove=(id:string)=>{
    if(!validId(id)||(!games.has(id)&&!files.has(id)))throw new Error('Game not found');
    // An unfinished legacy migration must not restore a deleted game on restart.
    if(fs.existsSync(legacy)){
      const stored:unknown=JSON.parse(fs.readFileSync(legacy,'utf8'));
      if(!Array.isArray(stored))throw new Error('Could not update legacy game storage');
      const remaining=stored.filter(value=>!object(value)||value.id!==id);
      if(remaining.length!==stored.length){
        fs.writeFileSync(legacy+'.tmp',JSON.stringify(remaining,null,2)+'\n',{mode:0o600});
        fs.renameSync(legacy+'.tmp',legacy);
      }
    }
    const file=files.get(id);
    if(file){fs.rmSync(file,{force:true});fs.rmSync(file+'.tmp',{force:true});}
    files.delete(id);games.delete(id);
  };
  return {games,save,remove,directory};
}

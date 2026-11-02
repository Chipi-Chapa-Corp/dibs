import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,ArrowRight,Plus,Users,Monitor,Settings2,Palette,Grid2X2,Undo2,Play,Pause,Flag,Hand,Check,X,Lock,Unlock,Copy,Download,Upload,ChevronDown,ArrowLeft,MoreHorizontal,Zap,QrCode,Pencil,RotateCcw,Trash2,Volume2,VolumeX} from 'lucide-react';
import type {GameSummary,GameView,Theme} from '../shared/model';
import {themes,defaultTheme,defaultSettings,emptyRound,isQuestionFilled} from '../shared/model';
import {api,download,go,number,playerKey,sortedPlayers,themeStyle,useGame,useGames,useNow,useToast} from './lib';
import {flushAutosaves} from './autosave';
import {useSoundCues} from './useSoundCues';
import {HostDailyDouble,PlayerDailyDouble} from './DailyDouble';
import {AnswerChoices,Board,Button,Checkbox,Connection,Empty,Field,IconButton,Invite,Logo,Modal,RichText,Scores,SelectionCue,StageContent} from './components';
import {QuestionsEditor,AppearanceEditor,SettingsEditor} from './editors';
type Command=(action:string,data?:Record<string,unknown>)=>Promise<boolean>;

export default function App(){const parts=location.pathname.split('/').filter(Boolean);if(parts[0]==='edit'&&parts[1])return <GameEditor id={parts[1].toUpperCase()}/>;if(parts[0]==='host'&&parts[1])return <Host id={parts[1].toUpperCase()}/>;if(parts[0]==='stage'&&parts[1])return <Stage id={parts[1].toUpperCase()}/>;if(parts[0]==='play'&&parts[1])return <PlayerEntry id={parts[1].toUpperCase()}/>;return <Lobby joinOnly={parts[0]==='play'}/>;}
async function copyGameForEditing(id:string){
  const definition=await api(`/api/games/${id}/export`);
  const name=`${definition.name} (copy)`.slice(0,80);
  const result=await api('/api/games',{name,definition:{...definition,name}});
  go(`/edit/${result.id}`);
}
function Lobby({joinOnly}:{joinOnly:boolean}){
  const{games,connected}=useGames();
  const[create,setCreate]=useState(false),[showEnded,setShowEnded]=useState(true),[share,setShare]=useState(false),[opening,setOpening]=useState<string|null>(null),[pendingDelete,setPendingDelete]=useState<GameSummary|null>(null);
  const toast=useToast();
  const visible=games.filter(g=>(showEnded||g.status!=='finished')&&(!joinOnly||g.questionTotal>0));
  const openGame=async(game:GameSummary,edit:boolean)=>{
    setOpening(game.id);
    try{
      if(edit&&game.status!=='lobby')await copyGameForEditing(game.id);
      else go(`/${edit?'edit':'host'}/${game.id}`);
    }catch(error){toast((error as Error).message);setOpening(null);}
  };
  return <div className="lobby-page">
    <header className="masthead lobby-header"><Logo/><div className="lobby-header-controls">{!joinOnly&&<Button variant="primary" onClick={()=>setCreate(true)}><Plus size={20}/>Create game</Button>}<Checkbox label="Show ended" checked={showEnded} onChange={setShowEnded}/></div><div className="header-actions"><Connection connected={connected}/><IconButton title="Join on your phone" onClick={()=>setShare(true)}><QrCode/></IconButton></div></header>
    <main className="lobby compact-lobby" aria-label={joinOnly?'Available games':'Games'}>
      {visible.length===0?<Empty>{joinOnly?'No games to join yet':'Create your first game to start preparing a board.'}</Empty>:<table className="game-list" aria-label={joinOnly?'Available games':'Games'}><thead className="visually-hidden"><tr><th scope="col">Number</th><th scope="col">Game</th><th scope="col">Status</th><th scope="col">Delete</th><th scope="col">Edit</th><th scope="col">Play</th></tr></thead><tbody>{visible.map((g,i)=>{
        const canManage=!joinOnly;
        const status=g.status==='lobby'?(g.questionTotal?'ready':'draft'):g.status;
        return <tr className="game-row" key={g.id}>
          <td className="game-index">{String(i+1).padStart(2,'0')}</td>
          <td className="game-name"><h2>{g.name}</h2><span className="game-meta">{g.rounds} {g.rounds===1?'round':'rounds'}<span>·</span>{g.questionTotal} {g.questionTotal===1?'question':'questions'}{g.playerCount>0&&<><span>·</span><Users size={18}/>{g.playerCount}</>}</span></td>
          <td className="game-status-cell"><span className={`game-status status-${status}`}><i/>{g.status==='lobby'?(joinOnly?'Waiting':g.questionTotal?'Ready to host':'Draft'):g.status==='playing'?'In progress':'Ended'}</span></td>
          <td className="game-delete-cell">{canManage&&<IconButton title={`Delete ${g.name}`} disabled={!!g.editing} onClick={()=>setPendingDelete(g)}><Trash2 size={18}/></IconButton>}</td>
          <td className="game-edit-cell">{canManage&&<Button disabled={opening===g.id||!!g.editing} title={g.editing?'Someone is editing this game':undefined} onClick={()=>void openGame(g,true)}>{g.status==='lobby'?<><Pencil size={18}/>Edit</>:<><Copy size={18}/>Copy & edit</>}</Button>}</td>
          <td className="game-play-cell">{canManage?<Button className="game-host" variant="primary" disabled={opening===g.id||!g.questionTotal} title={!g.questionTotal?'Add questions before hosting':undefined} onClick={()=>void openGame(g,false)}>Host<ArrowUpRight size={20}/></Button>:<a className="button game-action" href={g.status==='finished'?`/stage/${g.id}`:`/play/${g.id}`}>{g.status==='finished'?'Results':'Join'}<ArrowUpRight size={20}/></a>}</td>
        </tr>;
      })}</tbody></table>}
    </main>
    {create&&<CreateGame onClose={()=>setCreate(false)}/>}
    {pendingDelete&&<DeleteGameDialog game={pendingDelete} onClose={()=>setPendingDelete(null)}/>}
    {share&&<Invite title="Join on your phone" onClose={()=>setShare(false)}/>}
  </div>;
}
function DeleteGameDialog({game,onClose}:{game:GameSummary;onClose:()=>void}){
  const[busy,setBusy]=useState(false),[error,setError]=useState('');
  const toast=useToast();
  const remove=async()=>{
    setBusy(true);setError('');
    try{
      await api(`/api/games/${game.id}`,undefined,'DELETE');
      localStorage.removeItem(`jeopardy:player:${game.id}`);
      onClose();toast('Game deleted');
    }catch(error){setError((error as Error).message);setBusy(false);}
  };
  return <Modal title="Delete game?" onClose={()=>{if(!busy)onClose();}}>
    <p>Permanently delete <strong>{game.name}</strong>, including its players, scores and saved progress? Players and presenter screens will show that the game was deleted.</p>
    <p className="delete-game-warning">This cannot be undone.</p>
    {error&&<p className="delete-game-error" role="alert">{error}</p>}
    <div className="modal-actions"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button className="delete-game-confirm" disabled={busy} onClick={()=>void remove()}><Trash2 size={18}/>{busy?'Deleting…':'Delete game'}</Button></div>
  </Modal>;
}
function CreateGame({onClose}:{onClose:()=>void}){const[name,setName]=useState('Friday night'),[theme,setTheme]=useState<Theme['preset']>('paper'),[busy,setBusy]=useState(false),[imported,setImported]=useState<any>(null);const ref=useRef<HTMLInputElement>(null);const toast=useToast();return <Modal title="Create game" onClose={onClose}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{const result=await api('/api/games',{name,template:'empty',definition:imported?{...imported,name,theme:{...imported.theme,preset:theme,...themes[theme]}}:{theme:{...defaultTheme,preset:theme,...themes[theme]}}});go(`/edit/${result.id}`);}catch(err){toast((err as Error).message);setBusy(false);}}}><Field label="Name"><input autoFocus value={name} onChange={e=>setName(e.target.value)} required maxLength={80}/></Field><div className="field"><span>Theme</span><div className="theme-picks">{(Object.keys(themes)as Theme['preset'][]).map(k=><button type="button" key={k} className={`theme-pick ${theme===k?'selected':''}`} style={{background:themes[k].paper,color:themes[k].ink}} onClick={()=>setTheme(k)}><span style={{color:themes[k].accent}}>Aa</span>{k[0].toUpperCase()+k.slice(1)}{theme===k&&<Check size={18}/>}</button>)}</div></div>{imported&&<div className="import-summary"><Check size={20}/>{imported.rounds?.length} rounds imported</div>}<div className="modal-actions"><Button type="button" onClick={()=>ref.current?.click()}><Upload size={20}/>Import JSON</Button><Button variant="primary" type="submit" disabled={busy||!name.trim()}>{busy?'Creating…':'Create game'}<ArrowRight size={20}/></Button></div><input type="file" ref={ref} hidden accept="application/json,.json" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data.rounds))throw new Error('Not a Dibs game file');setImported(data);setName(data.name||f.name.replace('.json',''));}catch(err){toast((err as Error).message);}}}/></form></Modal>}

function LoadError({error,connected}:{error:string;connected?:boolean}){return <main className="loading-page"><Logo/>{error?<><h2>{error}</h2><a href="/" className="button">Back to games <ArrowLeft size={20}/></a></>:<div className="loading-line">Connecting<span/></div>}</main>}
function GameEditor({id}:{id:string}){
  const{g,connected,error,command,editorId}=useGame(id,'host',true);
  const[tab,setTab]=useState<'questions'|'appearance'|'settings'>('questions'),[busy,setBusy]=useState(false);
  const[loadingGame]=useState<GameView>(()=>({id,name:'',subtitle:'',createdAt:0,status:'lobby',paused:false,roundIndex:0,rounds:[emptyRound()],settings:structuredClone(defaultSettings),theme:structuredClone(defaultTheme),players:[],played:[],current:null,history:[],questionCount:0,selection:null,announcement:null,revision:0,modifierClaims:[],filledQuestionIds:[],role:'host',serverTime:0,currentQuestion:null,yourFinal:null}));
  const toast=useToast();
  const leave=async(url:string)=>{setBusy(true);try{if(await flushAutosaves())go(url);}finally{setBusy(false);}};
  if(!g&&error)return <LoadError error={error}/>;
  if(g&&g.status!=='lobby')return <div className="preparation-locked" style={themeStyle(g.theme)}>
    <Logo/><h1>This game has already started.</h1>
    <p>Make a copy to edit a new version with the same questions. The current game keeps its players and scores.</p>
    <div className="toolbar-actions"><a className="button" href="/">Game library</a><a className="button" href={`/host/${id}`}>Back to host</a><Button variant="primary" disabled={busy||!connected} onClick={async()=>{setBusy(true);try{await copyGameForEditing(id);}catch(e){toast((e as Error).message);setBusy(false);}}}><Copy size={20}/>Make a copy</Button></div>
  </div>;
  const tabs=[['questions',Grid2X2,'Questions'],['appearance',Palette,'Appearance'],['settings',Settings2,'Settings']]as const;
  const game=g||loadingGame;
  const ready=!!g&&connected&&g.editLock==='mine';
  const save=(data:Record<string,unknown>)=>ready?command('save',data):Promise.resolve(false);
  return <div className="preparation-app" style={themeStyle(game.theme)}>
    <header className="preparation-header"><Button disabled={busy} onClick={()=>void leave('/')}><ArrowLeft size={20}/>Library</Button><div className="preparation-title"><strong>{game.name||'\u00a0'}</strong></div><div className="header-actions"><Connection connected={connected}/><Button disabled={busy||!g||!connected} onClick={async()=>{try{if(!await flushAutosaves())return;download(`${game.name.toLowerCase().replace(/\W+/g,'-')}.json`,await api(`/api/games/${id}/export`));}catch(e){toast((e as Error).message);}}}><Download size={20}/>Export</Button><Button variant="primary" disabled={busy||!g||!connected} onClick={()=>void leave('/')}><Check size={20}/>Done</Button></div></header>
    <div className="preparation-shell"><nav className="preparation-tabs" aria-label="Game preparation">{tabs.map(([key,Icon,label])=><button key={key} className={tab===key?'active':''} aria-current={tab===key?'page':undefined} onClick={async()=>{if(await flushAutosaves())setTab(key);}}><Icon size={20}/>{label}</button>)}</nav>
      <main className={`preparation-main tab-${tab}`} aria-busy={!g||!connected}>{g?.editLock==='other'&&<p className="editor-lock-note" role="status"><Lock size={20}/>Someone else is editing this game. You can edit when they’re done.</p>}<fieldset className="preparation-fields" disabled={busy||!ready} key={g?g.editLock||'waiting':'loading'}>{tab==='questions'?<QuestionsEditor g={game} save={save} editorId={editorId}/>:tab==='appearance'?<AppearanceEditor g={game} save={save} editorId={editorId}/>:<SettingsEditor g={game} save={save} editorId={editorId}/>}</fieldset></main>
    </div>
  </div>;
}

function Host({id}:{id:string}){
  const{g,connected,error,command}=useGame(id,'host');
  const[invite,setInvite]=useState(false),[adjust,setAdjust]=useState<string|null>(null),[confirm,setConfirm]=useState<'finish'|'round'|null>(null),[reset,setReset]=useState(false),[more,setMore]=useState(false);
  const{muted,toggleSound}=useSoundCues(g,'host');
  const toast=useToast();
  if(!g)return <LoadError error={error} connected={connected}/>;
  const questionTotal=g.filledQuestionIds.length;
  const waitingForReady=g.settings.requireReady&&g.players.some(p=>!p.ready);
  return <div className="host-app hosting-app" style={themeStyle(g.theme)}>
    <header className="host-header"><a className="button library-link" href="/"><ArrowLeft size={20}/><span>Library</span></a><span className="host-game-name">{g.name}</span><div className="header-actions"><Connection connected={connected}/><Button onClick={()=>setInvite(true)}><Users size={20}/><span>Invite players</span></Button><a className="button" href={`/stage/${id}`} target="_blank" rel="noreferrer"><Monitor size={20}/>Presenter<ArrowUpRight size={18}/></a></div></header>
    <main className="host-main hosting-main">
      <div className="live-toolbar"><div className="round-select">{g.status==='lobby'?<span className="eyebrow">Lobby</span>:<><span className="eyebrow">Round</span><select aria-label="Current round" disabled={g.status==='finished'} value={g.roundIndex} onChange={e=>void command('round',{index:Number(e.target.value)})}>{g.rounds.map((r,i)=><option key={r.id} value={i}>{String(i+1).padStart(2,'0')} / {r.name}</option>)}</select>{g.paused&&<span className="tag">Paused</span>}</>}</div><div className="toolbar-actions"><IconButton title={muted?'Enable selection sound':'Mute selection sound'} aria-pressed={!muted} onClick={toggleSound}>{muted?<VolumeX/>:<Volume2/>}</IconButton><IconButton title="Undo last action" disabled={!g.history.length||!connected} onClick={()=>void command('undo')}><Undo2/></IconButton><Button onClick={()=>setMore(true)}><MoreHorizontal size={20}/>More</Button></div></div>
      <div className="live-layout"><section className="live-table">
        {g.status==='lobby'?<div className="host-waiting"><span className="eyebrow">Ready to host</span><h1>Gather your players.</h1><p>{g.rounds.length} {g.rounds.length===1?'round':'rounds'} · {questionTotal} {questionTotal===1?'question':'questions'}</p><p>Invite everyone to join, then start when you’re ready.</p><Button variant="primary" disabled={!connected||!questionTotal||waitingForReady||!!g.editLock} onClick={()=>void command('start')}><Play size={20}/>Start game</Button>{g.editLock&&<p className="field-hint">Someone is editing this game. You can start when they’re done.</p>}{waitingForReady&&<p className="field-hint">Waiting for everyone to mark themselves ready.</p>}{!questionTotal&&<p className="field-hint">This game needs questions first. Prepare it from the <a href="/">game library</a>.</p>}</div>
        :g.status==='finished'?<div className="host-results"><span className="eyebrow">Final standings</span><h1>{sortedPlayers(g.players).filter(p=>p.score===Math.max(...g.players.map(x=>x.score))).map(p=>p.name).join(' & ')||'Good game.'}</h1><Scores g={g}/><div className="results-actions"><Button variant="primary" disabled={!connected} onClick={()=>setReset(true)}><RotateCcw size={20}/>Play again</Button><a className="button" href="/">Choose another game<ArrowRight size={20}/></a></div></div>
        :g.current?<HostQuestion key={g.current.questionId} g={g} command={command} onAdjust={setAdjust}/>
        :<><Board g={g} onSelect={!g.paused&&!g.selection?q=>void command('selectQuestion',{questionId:q.id}):undefined}/><div className="board-bottom"><span>{g.played.filter(id=>g.rounds[g.roundIndex].categories.some(c=>c.questions.some(q=>q.id===id))).length} / {g.rounds[g.roundIndex].categories.reduce((a,c)=>a+c.questions.filter(isQuestionFilled).length,0)} played</span>{g.roundIndex<g.rounds.length-1?<Button onClick={()=>setConfirm('round')}>Next round<ArrowRight size={20}/></Button>:<Button onClick={()=>setConfirm('finish')}>Finish game<Flag size={20}/></Button>}</div></>}
      </section><aside className="live-side"><PlayerList g={g} command={command} onAdjust={setAdjust}/><ModifierReminders g={g} command={command} onAdjust={setAdjust}/><details className="history-panel"><summary>Activity<span>{g.history.length}</span></summary>{g.history.slice(0,12).map(h=><div className="history-item" key={h.id}><span>{h.label}</span><time>{new Date(h.at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</time></div>)}</details></aside></div>
    </main>
    {invite&&<Invite onClose={()=>setInvite(false)}/>}
    {adjust&&g.players.some(p=>p.id===adjust)&&<AdjustScore g={g} playerId={adjust} command={command} onClose={()=>setAdjust(null)}/>}
    {more&&<Modal title="Game controls" onClose={()=>setMore(false)}><div className="host-more-actions">
      {g.status==='playing'&&<Button disabled={!connected} onClick={async()=>{if(await command('pause'))setMore(false);}}>{g.paused?<Play size={20}/>:<Pause size={20}/>} {g.paused?'Resume game':'Pause game'}</Button>}
      {g.status==='finished'&&<Button disabled={!connected} onClick={async()=>{if(await command('resume'))setMore(false);}}><Play size={20}/>Resume game</Button>}
      {g.status==='playing'&&<Button onClick={()=>{setMore(false);setConfirm('finish');}}><Flag size={20}/>Finish game</Button>}
      <Button onClick={()=>{setMore(false);setReset(true);}}><RotateCcw size={20}/>Reset game</Button>
    </div></Modal>}
    {reset&&<ResetGameDialog name={g.name} command={command} onClose={()=>setReset(false)} onReset={()=>{setReset(false);setAdjust(null);setConfirm(null);toast('Game reset · players can join again');}}/>}
    {confirm&&<Modal title={confirm==='finish'?'Finish this game?':'Move to the next round?'} onClose={()=>setConfirm(null)}><div className="modal-actions"><Button onClick={()=>setConfirm(null)}>Cancel</Button><Button variant="primary" disabled={!connected} onClick={async()=>{if(await command(confirm==='finish'?'finish':'round',{index:g.roundIndex+1}))setConfirm(null);}}>{confirm==='finish'?'Show results':'Next round'}<ArrowRight size={20}/></Button></div></Modal>}
  </div>;
}
function ResetGameDialog({name,command,onClose,onReset}:{name:string;command:Command;onClose:()=>void;onReset:()=>void}){
  const[busy,setBusy]=useState(false),[error,setError]=useState('');
  const reset=async()=>{
    setBusy(true);setError('');
    try{
      if(await command('reset'))onReset();
      else setError('Could not reset the game. Please try again.');
    }finally{setBusy(false);}
  };
  return <Modal title="Reset game?" onClose={()=>{if(!busy)onClose();}}>
    <p>Reset <strong>{name}</strong> to the lobby? This removes all players and scores, clears game progress and claimed modifiers, and makes every question available again.</p>
    <p className="reset-game-note">Your questions, settings, appearance and room code stay the same. Players will need to join again.</p>
    <p className="reset-game-note">This cannot be undone.</p>
    {error&&<p className="reset-game-error" role="alert">{error}</p>}
    <div className="modal-actions"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={()=>void reset()}><RotateCcw size={18}/>{busy?'Resetting…':'Reset game'}</Button></div>
  </Modal>;
}

function HostQuestion({g,command,onAdjust}:{g:GameView;command:Command;onAdjust:(id:string)=>void}){const c=g.current!,q=g.currentQuestion!;const[wager,setWager]=useState(0),[wagerPlayer,setWagerPlayer]=useState(g.players[0]?.id||'');const final=g.rounds[g.roundIndex].type==='final';if(q.dailyDouble&&!final)return <HostDailyDouble g={g} command={command}/>;if(c.phase==='modifier')return <HostModifier g={g} command={command} onAdjust={onAdjust}/>;return <div className="host-question"><div className="question-meta"><span>{c.category}</span><span>{q.dailyDouble?'Daily double':number(q.value)}</span><IconButton title="Return to board" onClick={()=>void command('closeQuestion')}><X/></IconButton></div>{c.phase==='wager'?<><div className="wager-console"><h2>{q.dailyDouble?'Daily double':'Final wagers'}</h2><div className="inline-form"><select aria-label="Wagering player" value={wagerPlayer} onChange={e=>setWagerPlayer(e.target.value)}><option value="">Player</option>{g.players.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input aria-label="Wager amount" type="number" value={wager} min={0} onChange={e=>setWager(Number(e.target.value))}/><Button onClick={()=>void command('hostWager',{playerId:wagerPlayer,wager})}>Set wager</Button></div>{g.players.map(p=><div className="wager-person" key={p.id}><span>{p.name}</span><strong>{c.wagers[p.id]?number(c.wagers[p.id].wager):'Waiting'}</strong></div>)}<Button variant="primary" onClick={()=>void command('finalBegin')}>Lock wagers & open question<ArrowRight size={20}/></Button></div><div className="host-answer"><span className="eyebrow">Host preview</span><RichText text={q.prompt}/><hr/><RichText text={q.answer}/></div></>:<><div className="host-clue"><RichText text={q.prompt}/><AnswerChoices question={q}/></div><div className="host-answer"><div className="answer-heading"><span className="eyebrow">Answer · host only</span><Button onClick={()=>void command('reveal')} disabled={!!c.revealAt}>{c.revealed?'Revealed':c.revealAt?'Revealing…':'Reveal answer'}<ArrowUpRight size={18}/></Button></div><RichText text={q.answer}/>{q.notes&&<div className="host-notes"><RichText text={q.notes}/></div>}</div>{final?<div className="final-judging">{g.players.map(p=>{const entry=c.wagers[p.id];return <div className="final-player" key={p.id}><div><strong>{p.name}</strong><span>{number(entry?.wager||0)} wager</span><p>{entry?.answer||'No answer yet'}</p></div><Button disabled={entry?.judged} onClick={()=>void command('judge',{playerId:p.id,correct:false})}><X size={20}/></Button><Button variant="primary" disabled={entry?.judged} onClick={()=>void command('judge',{playerId:p.id,correct:true})}><Check size={20}/></Button></div>;})}</div>:<div className="judging-console"><select aria-label="Answering player" value={c.answeringId||''} onChange={e=>{if(e.target.value)void command('answerer',{playerId:e.target.value});}}><option value="">Select answerer</option>{g.players.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="judge-buttons"><Button disabled={!c.answeringId||c.closed} onClick={()=>void command('judge',{correct:false})}><X size={24}/>Incorrect</Button><Button variant="primary" disabled={!c.answeringId||c.closed} onClick={()=>void command('judge',{correct:true})}><Check size={24}/>Correct</Button></div></div>}<div className="buzzer-toolbar"><Button variant={c.buzzOpen?'primary':''} disabled={c.closed||!!c.revealAt} onClick={()=>void command(c.buzzOpen?'closeBuzzers':'openBuzzers')}>{c.buzzOpen?<Unlock size={20}/>:<Lock size={20}/>}Buzzers {c.buzzOpen?'open':'closed'}</Button><IconButton title="Clear queue and reopen" disabled={c.closed||!!c.revealAt} onClick={()=>void command('resetBuzzers')}><RotateCcw/></IconButton>{c.buzzes.length>0&&<span className="buzz-queue">{c.buzzes.map((b,i)=><span key={b.playerId}>{i+1}. {g.players.find(p=>p.id===b.playerId)?.name}</span>)}</span>}</div></>}<div className="question-next"><Button onClick={()=>void command('closeQuestion')}>Back to board<ArrowRight size={20}/></Button></div></div>}
function PlayerList({g,command,onAdjust}:{g:GameView;command:Command;onAdjust:(id:string)=>void}){
  const[adding,setAdding]=useState(false),[name,setName]=useState('');
  const lobby=g.status==='lobby';
  const ready=g.players.filter(p=>p.ready).length,online=g.players.filter(p=>p.connected).length;
  return <section className="player-list" aria-label="Players">
    <div className="side-heading"><h2>Players<span>{g.players.length}</span></h2><IconButton title="Add player manually" onClick={()=>setAdding(!adding)}><Plus/></IconButton></div>
    {lobby&&<div className="player-lobby-summary"><p role="status">{ready} / {g.players.length} ready · {online} online</p><p className="field-hint">Players tap “I’m ready” on their phones.</p></div>}
    {adding&&<form className="inline-form" onSubmit={async e=>{e.preventDefault();if(await command('addPlayer',{name})){setName('');setAdding(false);}}}><input aria-label="Player name" autoFocus placeholder="Name" value={name} onChange={e=>setName(e.target.value)} maxLength={32}/><IconButton title="Add player" disabled={!name.trim()}><ArrowRight/></IconButton></form>}
    {g.players.length?<div>{sortedPlayers(g.players).map(p=>{
      const player=g.players.find(x=>x.id===p.id)!;
      return <button className="player-row" key={p.id} onClick={()=>onAdjust(p.id)}>
        <i aria-hidden="true" className={`presence ${player.connected?'online':''}`} style={{'--player-color':p.color}as React.CSSProperties}/>
        <span className="player-row-identity"><span className="player-row-name">{p.name}</span><span className="player-row-status">
          {lobby&&<span className={player.ready?'player-ready':''}>{player.ready&&<Check size={16}/>} {player.ready?'Ready':'Not ready'}</span>}
          <span>{player.connected?'Online':'Offline'}</span>
        </span></span>
        <strong>{number(p.score)}</strong><MoreHorizontal size={18}/>
      </button>;
    })}</div>:<Empty>Waiting for players</Empty>}
  </section>;
}

function AdjustScore({g,playerId,command,onClose}:{g:GameView;playerId:string;command:Command;onClose:()=>void}){const p=g.players.find(p=>p.id===playerId)!;const[amount,setAmount]=useState(p.score),[rename,setRename]=useState(p.name),[remove,setRemove]=useState(false);return <Modal title={p.name} onClose={onClose}><form onSubmit={async e=>{e.preventDefault();if(await command('adjust',{playerId,amount,mode:'set'})){if(rename!==p.name)await command('renamePlayer',{playerId,name:rename});onClose();}}}><Field label="Name"><input value={rename} onChange={e=>setRename(e.target.value)} maxLength={32}/></Field><Field label="Score"><input autoFocus type="number" value={amount} onChange={e=>setAmount(Number(e.target.value))}/></Field><div className="score-steps">{[-500,-100,100,500].map(n=><Button key={n} type="button" onClick={()=>setAmount(a=>a+n)}>{n>0?'+':''}{n}</Button>)}</div><div className="modal-actions">{remove?<Button type="button" variant="danger" onClick={async()=>{await command('removePlayer',{playerId});onClose();}}>Confirm removal</Button>:<Button type="button" onClick={()=>setRemove(true)}>Remove player</Button>}<Button type="submit" variant="primary"><Check size={20}/>Save</Button></div></form></Modal>}
function HostModifier({g,command,onAdjust}:{g:GameView;command:Command;onAdjust:(id:string)=>void}){
  const c=g.current!,modifier=g.currentQuestion!.modifier!;
  const winner=g.players.find(p=>p.id===c.answeringId);
  return <div className="host-question host-mystery">
    <div className="question-meta"><span>{c.category}</span><span>Mystery modifier</span></div>
    <span className="display-star">✳</span>
    <h1>{winner?`${winner.name} claimed it`:'First to buzz claims it'}</h1>
    <p>{winner?'Apply the instructions manually, then return to the board.':'Buzzers are open. The modifier stays hidden until someone claims it.'}</p>
    <div className="host-answer"><span className="eyebrow">{winner?'Modifier instructions':'Host preview · hidden from players'}</span><h2>{modifier.title}</h2><RichText text={modifier.instructions}/></div>
    {g.currentQuestion!.notes&&<div className="host-notes"><RichText text={g.currentQuestion!.notes}/></div>}
    {winner&&<div className="manual-score-actions"><span>Edit scores if needed</span>{g.players.map(p=><Button key={p.id} onClick={()=>onAdjust(p.id)}>{p.name} · {number(p.score)}</Button>)}</div>}
    <div className="question-next"><Button onClick={()=>void command('closeQuestion')}>Back to board<ArrowRight size={20}/></Button></div>
  </div>;
}
function ModifierReminders({g,command,onAdjust}:{g:GameView;command:Command;onAdjust:(id:string)=>void}){
  if(!g.modifierClaims?.length)return null;
  return <section className="modifier-reminders"><div className="side-heading"><h2>Claimed modifiers</h2><Zap size={20}/></div>{g.modifierClaims.map(m=><div className="modifier-reminder" key={m.id}><div><strong>{m.title}</strong><IconButton title={`Dismiss ${m.title} reminder`} onClick={()=>void command('dismissModifier',{id:m.id})}><X size={18}/></IconButton></div><span className="field-hint">{g.players.find(p=>p.id===m.playerId)?.name||'Removed player'} · round {m.roundIndex+1}</span><RichText text={m.instructions}/>{g.players.some(p=>p.id===m.playerId)&&<Button onClick={()=>onAdjust(m.playerId)}>Edit score</Button>}</div>)}<p className="field-hint">Apply effects manually. Dismiss reminders when they expire.</p></section>;
}

function Stage({id}:{id:string}){const{g,error}=useGame(id,'stage');useEffect(()=>{document.title=g?`${g.name} · Presenter`:'Presenter';},[g?.name]);return g?<StageContent g={g}/>:<LoadError error={error}/>;}
function PlayerEntry({id}:{id:string}){const[hasToken,setHasToken]=useState(!!playerKey(id));return hasToken?<PlayerGame id={id} rejoin={()=>{localStorage.removeItem(`jeopardy:player:${id}`);setHasToken(false);}}/>:<JoinGame id={id} joined={()=>setHasToken(true)}/>;}
function JoinGame({id,joined}:{id:string;joined:()=>void}){const[g,set]=useState<GameView|null>(null),[name,setName]=useState(localStorage.getItem('jeopardy:name')||''),[busy,setBusy]=useState(false),[error,setError]=useState('');useEffect(()=>{api(`/api/games/${id}`).then(set).catch(e=>setError(e.message));},[id]);const toast=useToast();return <div className="join-page" style={g?themeStyle(g.theme):undefined}><header><Logo/><a href="/play"><ArrowLeft size={20}/>Games</a></header>{error?<Empty>{error}</Empty>:!g?<Empty>Connecting…</Empty>:<main><h1>{g.name}</h1><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{const p=await api(`/api/games/${id}/join`,{name});localStorage.setItem(`jeopardy:player:${id}`,p.token);localStorage.setItem('jeopardy:name',name);joined();}catch(e){toast((e as Error).message);}finally{setBusy(false);}}}><Field label="Your name"><input autoFocus value={name} onChange={e=>setName(e.target.value)} maxLength={32} required autoComplete="nickname"/></Field><Button variant="primary" disabled={busy||!name.trim()}>{busy?'Joining…':'Take a seat'}<ArrowRight size={22}/></Button></form></main>}</div>}
function PlayerGame({id,rejoin}:{id:string;rejoin:()=>void}){const{g,connected,error,deleted,command}=useGame(id,'player');const[wager,setWager]=useState(0),[answer,setAnswer]=useState('');const now=useNow();const buzz=()=>{if(navigator.vibrate)navigator.vibrate(25);void command('buzz');};useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.code==='Space'&&!(e.target as HTMLElement).closest('input,textarea,select')){e.preventDefault();buzz();}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[command]);if(deleted)return <LoadError error={error}/>;if(error)return <div className="join-page"><Logo/><Empty>{error}</Empty><Button onClick={rejoin}>Join again</Button></div>;if(!g)return <LoadError error=""/>;const self=g.players.find(p=>p.id===g.selfId);if(!self)return <LoadError error="Player not found"/>;const c=g.current,q=g.currentQuestion;const selected=c?.answeringId===self.id;const blocked=self.blockedUntil>now;const attempted=c?.attempted.includes(self.id);const already=c?.buzzes.some(b=>b.playerId===self.id);const canBuzz=connected&&g.status==='playing'&&!g.paused&&(c?.phase==='question'||c?.phase==='modifier')&&!c.closed&&!c.revealAt&&(c.phase==='modifier'||!blocked)&&!attempted&&!already&&c.buzzOpen;return <div className="player-app" style={themeStyle(g.theme)}><header className="player-header"><a href="/play" aria-label="Back to games"><ArrowLeft/></a><span>{g.name}</span><Connection connected={connected}/></header><main className="player-main"><div className="player-identity"><span><i className="player-marker" style={{background:self.color}}/>{self.name}</span></div>{g.settings.showScoresOnPhone&&<div className="my-score"><strong>{number(self.score)}</strong><span>points</span></div>}{g.status==='finished'?<div className="player-final"><span className="display-star">✳</span><h1>{self.score===Math.max(...g.players.map(p=>p.score))?'Your night.':'Good game.'}</h1><Scores g={g}/></div>:g.status==='lobby'?<div className="player-waiting"><span className="display-star">✳</span><Button variant={self.ready?'primary':''} onClick={()=>void command('ready',{ready:!self.ready})}>{self.ready?<Check/>:<Hand/>}{self.ready?'Ready':'I’m ready'}</Button></div>:g.selection?<SelectionCue g={g}/>:q?.dailyDouble&&c?<PlayerDailyDouble key={q.id} g={g} command={command}/>:c?.phase==='wager'&&(g.rounds[g.roundIndex].type==='final'||c.answeringId===self.id)?<form className="player-wager" onSubmit={e=>{e.preventDefault();void command('wager',{wager});}}><h2>{g.yourFinal?'Wager locked':'Make your wager'}</h2>{g.yourFinal?<strong>{number(g.yourFinal.wager)}</strong>:<><Field label="Points"><input type="number" value={wager} min={0} max={g.settings.finalMaxWager==='score'?Math.max(0,self.score,q?.dailyDouble?q.value:0):undefined} onChange={e=>setWager(Number(e.target.value))}/></Field><Button variant="primary">Lock wager<Lock size={20}/></Button></>}</form>:c?.phase==='modifier'?<PlayerModifier g={g} canClaim={!!canBuzz} buzz={buzz}/>:<>{q&&g.settings.showQuestionOnPhone&&c?.phase!=='wager'&&<div className="phone-question"><span className="eyebrow">{c?.category} · {number(q.value)}</span><RichText text={q.prompt}/><AnswerChoices question={q}/></div>}{c?.phase==='final'&&!c.revealed&&!c.revealAt?<form className="player-answer-form" onSubmit={e=>{e.preventDefault();void command('finalAnswer',{answer});}}><Field label="Your answer"><textarea value={answer} onChange={e=>setAnswer(e.target.value)} rows={3} maxLength={5000}/></Field><Button variant="primary" disabled={!connected||g.paused}>Submit answer<ArrowRight size={20}/></Button>{g.yourFinal?.answer&&<span className="submitted">Saved · you can edit until the presenter reveals the answer</span>}</form>:c?.revealed&&q?<div className="phone-answer"><span className="eyebrow">Answer</span><RichText text={q.answer}/></div>:<div className="buzz-area"><button aria-label="Buzz in" className={`buzz-button ${selected?'has-floor':''}`} disabled={!canBuzz} onPointerDown={e=>{if(canBuzz){e.preventDefault();buzz();}}} onClick={e=>{if(e.detail===0&&canBuzz)buzz();}}><Hand strokeWidth={1.2}/><span>{selected?'Your turn':blocked?`${Math.ceil((self.blockedUntil-now)/1000)}s`:g.paused?'Paused':attempted?'Next one':already?'In the queue':canBuzz?'I know this':c?.phase==='wager'?'Wagering':'Stand by'}</span></button><span className="buzz-caption">{selected?'You have the floor':c?.answeringId?`${g.players.find(p=>p.id===c.answeringId)?.name} has the floor`:!c?'The next question is coming':blocked?'A little patience':c.revealAt?'The answer is coming':canBuzz?'Tap when you know':'Watch the main screen'}</span></div>}</>}{g.status==='playing'&&g.modifierClaims?.some(m=>m.playerId===self.id&&m.questionId!==c?.questionId)&&<section className="modifier-reminders"><h2>Your modifiers</h2>{g.modifierClaims.filter(m=>m.playerId===self.id&&m.questionId!==c?.questionId).map(m=><div key={m.id} className="modifier-reminder"><strong>{m.title}</strong><RichText text={m.instructions}/></div>)}</section>}{g.settings.showScoresOnPhone&&g.status!=='finished'&&<details className="phone-scores"><summary>Standings<ChevronDown size={20}/></summary><Scores g={g}/></details>}</main></div>}

function PlayerModifier({g,canClaim,buzz}:{g:GameView;canClaim:boolean;buzz:()=>void}){
  const c=g.current!,winner=g.players.find(p=>p.id===c.answeringId);
  const yours=winner?.id===g.selfId;
  return <section className="phone-mystery"><span className="eyebrow">Mystery modifier</span><h1>{winner?(yours?'You claimed it!':`${winner.name} claimed it`):'Feeling lucky?'}</h1>
    {c.revealed&&g.currentQuestion?.modifier?<><h2>{g.currentQuestion.modifier.title}</h2><RichText text={g.currentQuestion.modifier.instructions}/><p>The presenter will apply this modifier.</p></>:winner?<p>Revealing the modifier…</p>:<><p>First to tap gets it. What it does is still a mystery.</p><div className="buzz-area"><button className="buzz-button" aria-label="Claim modifier" disabled={!canClaim} onPointerDown={e=>{if(canClaim){e.preventDefault();buzz();}}} onClick={e=>{if(e.detail===0&&canClaim)buzz();}}><Zap/><span>{g.paused?'Paused':'Claim it'}</span></button></div></>}
  </section>;
}

import {FinalCategories} from './FinalCategories';
import {useEffect,useRef,useState} from 'react';
import {AppLink,usePathname} from './navigation';
import {ArrowUpRight,ArrowRight,Plus,Users,Monitor,Settings2,Palette,Grid2X2,Layers,CircleHelp,Play,Pause,Flag,Hand,Check,X,Lock,Unlock,Copy,Download,Upload,ChevronDown,ArrowLeft,MoreHorizontal,Zap,QrCode,Pencil,RotateCcw,Trash2,LogOut,Volume2,VolumeX} from 'lucide-react';
import type {GameSummary,GameView,Theme} from '../shared/model';
import {themes,defaultTheme,defaultSettings,emptyRound,roundName} from '../shared/model';
import {api,download,go,number,playerKey,sortedPlayers,themeStyle,useGame,useGames,useNow,useToast} from './lib';
import {flushAutosaves} from './autosave';
import {useSoundCues} from './useSoundCues';
import {HostDailyDouble} from './DailyDouble';
import {FinalWagers} from './FinalWagers';
import {FinalResults} from './FinalResults';
import {FinalAnswers} from './FinalAnswers';
import {FinalSubmission} from './FinalSubmission';
import {AnswerDecision} from './AnswerDecision';
import {TeamsPanel} from './TeamsPanel';
import {AnswerChoices,Board,Button,Connection,Empty,Field,IconButton,Invite,Logo,Modal,RichText,Scores,StageContent} from './components';
import {QuestionsEditor,AppearanceEditor,SettingsEditor} from './editors';
type Command=(action:string,data?:Record<string,unknown>)=>Promise<boolean>;
const gameStatuses={lobby:'Not started',playing:'Ongoing',finished:'Finished'};

export default function App(){const pathname=usePathname();const parts=pathname.split('/').filter(Boolean);if(parts[0]==='edit'&&parts[1])return <GameEditor key={pathname} id={parts[1].toUpperCase()}/>;if(parts[0]==='host'&&parts[1])return <Host key={pathname} id={parts[1].toUpperCase()}/>;if(parts[0]==='stage'&&parts[1])return <Stage key={pathname} id={parts[1].toUpperCase()}/>;if(parts[0]==='play'&&parts[1])return <PlayerEntry key={pathname} id={parts[1].toUpperCase()}/>;return <Lobby key={pathname} joinOnly={parts[0]==='play'}/>;}
async function copyGameForEditing(id:string){
  const definition=await api(`/api/games/${id}/export`);
  const name=`${definition.name} (copy)`.slice(0,80);
  const result=await api('/api/games',{name,definition:{...definition,name}});
  go(`/edit/${result.id}`);
}
function Lobby({joinOnly}:{joinOnly:boolean}){
  const{games,connected}=useGames();
  const[create,setCreate]=useState(false),[statusFilter,setStatusFilter]=useState<GameSummary['status']|'all'>('all'),[share,setShare]=useState(false),[opening,setOpening]=useState<string|null>(null),[pendingDelete,setPendingDelete]=useState<GameSummary|null>(null);
  const toast=useToast();
  const available=games.filter(g=>!joinOnly||g.questionTotal>0);
  const visible=available.filter(g=>statusFilter==='all'||g.status===statusFilter);
  const openGame=async(game:GameSummary,edit:boolean)=>{
    setOpening(game.id);
    try{
      if(edit&&game.status!=='lobby')await copyGameForEditing(game.id);
      else go(`/${edit?'edit':'host'}/${game.id}`);
    }catch(error){toast((error as Error).message);setOpening(null);}
  };
  return <div className="lobby-page">
    <header className="masthead lobby-header"><Logo/><div className="lobby-header-controls">{!joinOnly&&<Button variant="primary" onClick={()=>setCreate(true)}><Plus size={20}/>Create game</Button>}<select aria-label="Filter games by status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">All games</option>{Object.entries(gameStatuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><div className="header-actions"><Connection connected={connected}/><IconButton title="Join on your phone" onClick={()=>setShare(true)}><QrCode/></IconButton></div></header>
    <main className="lobby compact-lobby" aria-label={joinOnly?'Available games':'Games'}>
      {visible.length===0?<Empty>{available.length?'No games match this status.':joinOnly?'No games to join yet':'Create your first game to start preparing a board.'}</Empty>:<table className="game-list" aria-label={joinOnly?'Available games':'Games'}><thead className="visually-hidden"><tr><th scope="col">Number</th><th scope="col">Game</th><th scope="col">Status</th><th scope="col">Delete</th><th scope="col">Edit</th><th scope="col">Play</th></tr></thead><tbody>{visible.map((g,i)=>{
        const canManage=!joinOnly;
        return <tr className="game-row" key={g.id}>
          <td className="game-index">{String(i+1).padStart(2,'0')}</td>
          <td className="game-name"><h2>{g.name}</h2><span className="game-meta">
            <span className="game-meta-count" aria-label={`${g.rounds} ${g.rounds===1?'round':'rounds'}`}><Layers className="game-meta-icon" size={18} aria-hidden="true"/>{g.rounds}<span className="game-meta-label">{g.rounds===1?'round':'rounds'}</span></span>
            <span aria-hidden="true">·</span>
            <span className="game-meta-count" aria-label={`${g.questionTotal} ${g.questionTotal===1?'question':'questions'}`}><CircleHelp className="game-meta-icon" size={18} aria-hidden="true"/>{g.questionTotal}<span className="game-meta-label">{g.questionTotal===1?'question':'questions'}</span></span>
            {g.playerCount>0&&<><span aria-hidden="true">·</span><span className="game-meta-count" aria-label={`${g.playerCount} ${g.playerCount===1?'team':'teams'}`}><Users size={18} aria-hidden="true"/>{g.playerCount}</span></>}
            <span className="game-mobile-status"><span aria-hidden="true">·</span><span className={`game-status status-${g.status}`}>{gameStatuses[g.status]}</span></span>
          </span></td>
          <td className="game-status-cell"><span className={`game-status status-${g.status}`}><i aria-hidden="true"/>{gameStatuses[g.status]}</span></td>
          <td className="game-delete-cell">{canManage&&<IconButton title={`Delete ${g.name}`} disabled={!!g.editing} onClick={()=>setPendingDelete(g)}><Trash2 size={18}/></IconButton>}</td>
          <td className="game-edit-cell">{canManage&&<Button disabled={opening===g.id||!!g.editing} title={g.editing?'Someone is editing this game':undefined} onClick={()=>void openGame(g,true)}>{g.status==='lobby'?<><Pencil size={18}/>Edit</>:<><Copy size={18}/>Copy</>}</Button>}</td>
          <td className="game-play-cell">{!g.hosting?<Button className="game-host" variant="primary" disabled={opening===g.id||!g.questionTotal} title={!g.questionTotal?'Add questions before hosting':undefined} onClick={()=>void openGame(g,false)}>Host<ArrowUpRight size={20}/></Button>:<AppLink className="button primary game-action" href={g.status==='finished'?`/stage/${g.id}`:`/play/${g.id}`}>{g.status==='finished'?'Results':'Join'}<ArrowUpRight size={20}/></AppLink>}</td>
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
    <p>Permanently delete <strong>{game.name}</strong>, including its teams, scores and saved progress? Team buzzers and presenter screens will show that the game was deleted.</p>
    <p className="delete-game-warning">This cannot be undone.</p>
    {error&&<p className="delete-game-error" role="alert">{error}</p>}
    <div className="modal-actions"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button className="delete-game-confirm" disabled={busy} onClick={()=>void remove()}><Trash2 size={18}/>{busy?'Deleting…':'Delete game'}</Button></div>
  </Modal>;
}
function CreateGame({onClose}:{onClose:()=>void}){const[name,setName]=useState('Friday night'),[theme,setTheme]=useState<Theme['preset']>('paper'),[busy,setBusy]=useState(false),[imported,setImported]=useState<any>(null);const ref=useRef<HTMLInputElement>(null);const toast=useToast();return <Modal title="Create game" onClose={onClose}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{const result=await api('/api/games',{name,template:'empty',definition:imported?{...imported,name,theme:{...imported.theme,preset:theme,...themes[theme]}}:{theme:{...defaultTheme,preset:theme,...themes[theme]}}});go(`/edit/${result.id}`);}catch(err){toast((err as Error).message);setBusy(false);}}}><Field label="Name"><input autoFocus value={name} onChange={e=>setName(e.target.value)} required maxLength={80}/></Field><div className="field"><span>Theme</span><div className="theme-picks">{(Object.keys(themes)as Theme['preset'][]).map(k=><button type="button" key={k} className={`theme-pick ${theme===k?'selected':''}`} style={{background:themes[k].paper,color:themes[k].ink}} onClick={()=>setTheme(k)}><span style={{color:themes[k].accent}}>Aa</span>{k[0].toUpperCase()+k.slice(1)}{theme===k&&<Check size={18}/>}</button>)}</div></div>{imported&&<div className="import-summary"><Check size={20}/>{imported.rounds?.length} rounds imported</div>}<div className="modal-actions"><Button type="button" onClick={()=>ref.current?.click()}><Upload size={20}/>Import JSON</Button><Button variant="primary" type="submit" disabled={busy||!name.trim()}>{busy?'Creating…':'Create game'}<ArrowRight size={20}/></Button></div><input type="file" ref={ref} hidden accept="application/json,.json" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data.rounds))throw new Error('Not a Dibs game file');setImported(data);setName(data.name||f.name.replace('.json',''));}catch(err){toast((err as Error).message);}}}/></form></Modal>}

function LoadError({error,connected}:{error:string;connected?:boolean}){return <main className="loading-page"><Logo/>{error?<><h2>{error}</h2><AppLink href="/" className="button">Back to games <ArrowLeft size={20}/></AppLink></>:<div className="loading-line">Connecting<span/></div>}</main>}
function GameEditor({id}:{id:string}){
  const{g,connected,error,command,editorId}=useGame(id,'host',true);
  const[tab,setTab]=useState<'questions'|'appearance'|'settings'>('questions'),[busy,setBusy]=useState(false);
  const[loadingGame]=useState<GameView>(()=>({id,name:'',subtitle:'',createdAt:0,status:'lobby',paused:false,roundIndex:0,rounds:[emptyRound()],settings:structuredClone(defaultSettings),theme:structuredClone(defaultTheme),teamsLocked:false,members:[],players:[],played:[],current:null,history:[],questionCount:0,selection:null,announcement:null,revision:0,modifierClaims:[],filledQuestionIds:[],role:'host',canUndo:false,serverTime:0,currentQuestion:null,yourFinal:null}));
  const toast=useToast();
  const leave=async(url:string)=>{setBusy(true);try{if(await flushAutosaves())go(url);}finally{setBusy(false);}};
  if(!g&&error)return <LoadError error={error}/>;
  if(g&&g.status!=='lobby')return <div className="preparation-locked" style={themeStyle(g.theme)}>
    <Logo/><h1>This game has already started.</h1>
    <p>Make a copy to edit a new version with the same questions. The current game keeps its teams and scores.</p>
    <div className="toolbar-actions"><AppLink className="button" href="/">Game library</AppLink><AppLink className="button" href={`/host/${id}`}>Back to host</AppLink><Button variant="primary" disabled={busy||!connected} onClick={async()=>{setBusy(true);try{await copyGameForEditing(id);}catch(e){toast((e as Error).message);setBusy(false);}}}><Copy size={20}/>Make a copy</Button></div>
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
  if(!g&&error==='Someone is already hosting this game.')return <main className="loading-page"><Logo/><h2>{error}</h2><AppLink className="button primary" href={`/play/${id}`}>Join<ArrowRight size={20}/></AppLink><AppLink className="button" href="/">Back to games<ArrowLeft size={20}/></AppLink></main>;
  if(!g)return <LoadError error={error} connected={connected}/>;
  const questionTotal=g.filledQuestionIds.length;
  const waitingForReady=g.players.some(p=>!p.ready);
  return <div className="host-app hosting-app" style={themeStyle(g.theme)}>
    <header className="host-header"><div className="host-header-identity"><AppLink className="icon-button host-header-button library-link" href="/" title="Library" aria-label="Library"><ArrowLeft size={22}/></AppLink><span className="host-game-name">{g.name}</span></div><div className="header-actions"><Connection connected={connected}/><IconButton className="icon-button host-header-button" title="Game controls" onClick={()=>setMore(true)}><Settings2 size={22}/></IconButton><IconButton className="icon-button host-header-button" title="Invite" onClick={()=>setInvite(true)}><Users size={22}/></IconButton><AppLink className="icon-button host-header-button" href={`/stage/${id}`} target="_blank" rel="noreferrer" title="Presenter" aria-label="Presenter"><Monitor size={22}/></AppLink></div></header>
    <main className="host-main hosting-main">
      {g.status!=='lobby'&&<div className="live-toolbar"><div className="round-select"><span className="eyebrow">Round</span><select aria-label="Current round" disabled={g.status==='finished'} value={g.roundIndex} onChange={e=>void command('round',{index:Number(e.target.value)})}>{g.rounds.map((r,i)=><option key={r.id} value={i}>{roundName(i)}{r.type==='final'?' · Final':''}</option>)}</select>{g.paused&&<span className="tag">Paused</span>}</div></div>}
      <div className="live-layout"><section className="live-table">
        {g.status==='lobby'?<div className="host-waiting"><span className="eyebrow">Ready to host</span><h1>Gather your teams.</h1><p>{g.rounds.length} {g.rounds.length===1?'round':'rounds'} · {questionTotal} {questionTotal===1?'question':'questions'}</p><Button variant="primary" disabled={!connected||!questionTotal||!g.players.length||waitingForReady||!!g.editLock} onClick={()=>void command('start')}><Play size={20}/>Start game</Button>{!g.players.length&&<p className="field-hint">Create your teams using the + button before starting.</p>}{g.editLock&&<p className="field-hint">Someone is editing this game. You can start when they’re done.</p>}{waitingForReady&&<p className="field-hint">Waiting for all teams to mark themselves ready.</p>}{!questionTotal&&<p className="field-hint">This game needs questions first. Prepare it from the <AppLink href="/">game library</AppLink>.</p>}</div>
        :g.status==='finished'?<div className="host-results"><span className="eyebrow">Final standings</span><h1>{sortedPlayers(g.players).filter(p=>p.score===Math.max(...g.players.map(x=>x.score))).map(p=>p.name).join(' & ')||'Good game.'}</h1><Scores g={g}/><div className="results-actions"><Button variant="primary" disabled={!connected} onClick={()=>setReset(true)}><RotateCcw size={20}/>Play again</Button><AppLink className="button" href="/">Choose another game<ArrowRight size={20}/></AppLink></div></div>
        :g.rounds[g.roundIndex].type==='final'&&!g.current?<FinalCategories g={g} command={command}/>:g.current?<HostQuestion key={g.current.questionId} g={g} command={command}/>
        :<><Board g={g} onSelect={!g.paused&&!g.selection?q=>void command('selectQuestion',{questionId:q.id}):undefined}/><div className="board-bottom">{g.roundIndex<g.rounds.length-1?<Button onClick={()=>setConfirm('round')}>Next round<ArrowRight size={20}/></Button>:<Button onClick={()=>setConfirm('finish')}>Finish game<Flag size={20}/></Button>}</div></>}
      </section><aside className="live-side"><PlayerList g={g} command={command} onAdjust={setAdjust}/><ModifierReminders g={g} command={command}/></aside></div>
    </main>
    {invite&&<Invite onClose={()=>setInvite(false)}/>}
    {adjust&&<TeamsPanel g={g} command={command} onClose={()=>setAdjust(null)}/>}
    {more&&<Modal title="Game controls" onClose={()=>setMore(false)}><div className="host-more-actions">
      <Button aria-pressed={!muted} onClick={toggleSound}>{muted?<VolumeX size={20}/>:<Volume2 size={20}/>} {muted?'Enable selection sound':'Mute selection sound'}</Button>
      {g.status==='playing'&&<Button disabled={!connected} onClick={async()=>{if(await command('pause'))setMore(false);}}>{g.paused?<Play size={20}/>:<Pause size={20}/>} {g.paused?'Resume game':'Pause game'}</Button>}
      {g.status==='finished'&&<Button disabled={!connected} onClick={async()=>{if(await command('resume'))setMore(false);}}><Play size={20}/>Resume game</Button>}
      {g.status==='playing'&&<Button onClick={()=>{setMore(false);setConfirm('finish');}}><Flag size={20}/>Finish game</Button>}
      <Button disabled={!connected} onClick={()=>{setMore(false);setReset(true);}}><RotateCcw size={20}/>Reset game</Button>
    </div></Modal>}
    {reset&&<ResetGameDialog name={g.name} command={command} onClose={()=>setReset(false)} onReset={()=>{setReset(false);setAdjust(null);setConfirm(null);toast('Game reset · teams can join again');}}/>}
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
    <p>Reset <strong>{name}</strong> to the lobby? This removes all teams and scores, clears game progress and claimed modifiers, and makes every question available again.</p>
    <p className="reset-game-note">Your questions, settings, appearance and room code stay the same. Teams will need to join again.</p>
    <p className="reset-game-note">This cannot be undone.</p>
    {error&&<p className="reset-game-error" role="alert">{error}</p>}
    <div className="modal-actions"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={()=>void reset()}><RotateCcw size={18}/>{busy?'Resetting…':'Reset game'}</Button></div>
  </Modal>;
}

function HostQuestion({g,command}:{g:GameView;command:Command}){const c=g.current!,q=g.currentQuestion!;const final=g.rounds[g.roundIndex].type==='final';if(q.dailyDouble&&!final)return <HostDailyDouble g={g} command={command}/>;if(c.phase==='modifier')return <HostModifier g={g} command={command}/>;return <div className="host-question"><div className="question-meta"><span>{c.category}</span><span>{q.dailyDouble?'Daily double':number(q.value)}</span></div>{c.phase==='wager'?<><FinalWagers g={g} command={command}/><div className="host-answer"><span className="eyebrow">Host preview</span><RichText text={q.prompt}/><hr/><RichText text={q.answer}/></div></>:<><div className="host-clue"><RichText text={q.prompt}/><AnswerChoices question={q}/></div><div className="host-answer"><div className="answer-heading"><span className="eyebrow">Answer · host only</span></div><RichText text={q.answer}/>{q.notes&&<div className="host-notes"><RichText text={q.notes}/></div>}</div>{final?<FinalAnswers g={g} command={command}/>:<AnswerDecision key={`${c.questionId}:${c.answerToken||'waiting'}`} g={g} command={command}/>}</>}</div>}
function PlayerList({g,command,onAdjust}:{g:GameView;command:Command;onAdjust:(id:string)=>void}){
  const[adding,setAdding]=useState(false),[name,setName]=useState('');
  const addTeamButton=useRef<HTMLButtonElement>(null);
  const restoreAddTeamFocus=useRef(false);
  const lobby=g.status==='lobby',canEditTeams=lobby&&!g.teamsLocked;
  const ready=g.players.filter(p=>p.ready).length;
  useEffect(()=>{
    if(!adding&&restoreAddTeamFocus.current){addTeamButton.current?.focus();restoreAddTeamFocus.current=false;}
    if(!adding||!canEditTeams)return;
    const dismiss=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||event.defaultPrevented||(event.target instanceof Element&&event.target.closest('[role="dialog"]')))return;
      event.preventDefault();restoreAddTeamFocus.current=true;setAdding(false);
    };
    document.addEventListener('keydown',dismiss);return()=>document.removeEventListener('keydown',dismiss);
  },[adding,canEditTeams]);
  return <section className="player-list" aria-label="Teams">
    {lobby&&<div className="player-lobby-summary"><p role="status">{ready} / {g.players.length} teams ready</p></div>}
    {g.players.length?<div>{g.players.map(p=>{
      const player=g.players.find(x=>x.id===p.id)!,members=g.members.filter(m=>m.teamId===p.id);
      const incorrect=g.current?.incorrectTeamIds?.includes(p.id),passed=g.current?.passedTeamIds?.includes(p.id);
      const correct=g.current?.judgments?.[p.id]?.result==='correct'||g.current?.wagers[p.id]?.judged===true&&g.current.wagers[p.id].correct===true;
      const pending=g.current?.phase==='final'&&!correct&&!incorrect&&!passed;
      return <button className={`player-row${correct?' correct':incorrect?' incorrect':passed?' passed':''}`} key={p.id} onClick={()=>onAdjust(p.id)}>
        <i aria-hidden="true" className="player-marker" style={{background:p.color}}/>
        <span className="player-row-identity"><span className="player-row-name">{p.name}</span>{lobby&&<span className="player-row-status"><span className={player.ready?'player-ready':''}>{player.ready&&<Check size={16}/>} {player.ready?'Ready':'Not ready'}</span></span>}{(correct||incorrect||passed||pending)&&<span className={`player-answer-status${pending?' pending':''}`} role="status">{correct?<Check size={18} aria-hidden="true"/>:incorrect?<X size={18} aria-hidden="true"/>:null}{correct?'Correct':incorrect?'Incorrect':passed?'Passed':'Not judged'}</span>}<span className="player-row-status">{members.filter(m=>m.connected).length} / {members.length} players connected</span></span>
        <strong>{number(p.score)}</strong><MoreHorizontal size={18}/>
      </button>;
    })}</div>:<Empty>Create teams before starting</Empty>}
    {canEditTeams&&<div className="side-heading">{adding?<form className="add-team-form" onSubmit={async e=>{e.preventDefault();if(name.trim()&&await command('addTeam',{name})){setName('');restoreAddTeamFocus.current=true;setAdding(false);}}}><input aria-label="Team name" autoFocus placeholder="Team name" value={name} onChange={e=>setName(e.target.value)} maxLength={32}/><IconButton title="Add team" disabled={!name.trim()}><ArrowRight/></IconButton></form>:<button type="button" className="button" ref={addTeamButton} aria-expanded={false} onClick={()=>setAdding(true)}><Plus size={20}/>Add team</button>}</div>}
  </section>;
}

function HostModifier({g,command}:{g:GameView;command:Command}){
  const c=g.current!,modifier=g.currentQuestion!.modifier!;
  const winner=g.players.find(p=>p.id===c.answeringId);
  return <div className="host-question host-mystery">
    <div className="question-meta"><span>{c.category}</span><span>Mystery modifier</span></div>
    <span className="display-star">✳</span>
    <h1>{winner?`${winner.name} claimed it`:'First to buzz claims it'}</h1>
    {!winner&&<p>Buzzers are open. The modifier stays hidden until someone claims it.</p>}
    <div className="host-answer"><span className="eyebrow">{winner?'Modifier instructions':'Host preview · hidden from teams'}</span><h2>{modifier.title}</h2><RichText text={modifier.instructions}/></div>
    {g.currentQuestion!.notes&&<div className="host-notes"><RichText text={g.currentQuestion!.notes}/></div>}
    <div className="question-next"><Button onClick={()=>void command('closeQuestion')}>Continue<ArrowRight size={20}/></Button></div>
  </div>;
}
function ModifierReminders({g,command}:{g:GameView;command:Command}){
  if(!g.modifierClaims?.length)return null;
  return <section className="modifier-reminders"><div className="side-heading"><h2>Claimed modifiers</h2><Zap size={20}/></div>{g.modifierClaims.map(m=><div className="modifier-reminder" key={m.id}><div><strong>{m.title}</strong><IconButton title={`Dismiss ${m.title} reminder`} onClick={()=>void command('dismissModifier',{id:m.id})}><X size={18}/></IconButton></div><span className="field-hint">{g.players.find(p=>p.id===m.playerId)?.name||'Removed team'} · round {m.roundIndex+1}</span><RichText text={m.instructions}/></div>)}</section>;
}

function Stage({id}:{id:string}){const{g,error}=useGame(id,'stage');useEffect(()=>{document.title=g?`${g.name} · Presenter`:'Presenter';},[g?.name]);return g?<StageContent g={g}/>:<LoadError error={error}/>;}
function PlayerEntry({id}:{id:string}){const[hasToken,setHasToken]=useState(!!playerKey(id));return hasToken?<PlayerGame id={id} rejoin={()=>{localStorage.removeItem(`jeopardy:player:${id}`);setHasToken(false);}}/>:<JoinGame id={id} joined={()=>setHasToken(true)}/>;}
function JoinGame({id,joined}:{id:string;joined:()=>void}){
  const{g,error}=useGame(id,'stage');
  const[name,setName]=useState(localStorage.getItem('jeopardy:member:name')||''),[teamId,setTeam]=useState(''),[busy,setBusy]=useState(false);
  const toast=useToast();
  return <div className="join-page" style={g?themeStyle(g.theme):undefined}>
    <header><Logo/><AppLink href="/play"><ArrowLeft size={20}/>Games</AppLink></header>
    {error?<Empty>{error}</Empty>:!g?<Empty>Connecting…</Empty>:<main><h1>{g.name}</h1>{g.status==='finished'?<Empty>This game has ended.</Empty>:!g.players.length?<Empty>Waiting for the host to create teams.</Empty>:<form onSubmit={async e=>{
      e.preventDefault();setBusy(true);
      try{
        const p=await api(`/api/games/${id}/join`,{name,teamId});
        localStorage.setItem(`jeopardy:player:${id}`,p.token);localStorage.setItem('jeopardy:member:name',name);joined();
      }catch(e){toast((e as Error).message);}finally{setBusy(false);}
    }}>
      <Field label="Your name"><input autoFocus value={name} onChange={e=>setName(e.target.value)} maxLength={32} required autoComplete="nickname"/></Field>
      <Field label="Team"><select required value={teamId} onChange={e=>setTeam(e.target.value)}><option value="" disabled>Choose your team</option>{g.players.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <p className="field-hint">Each player has their own buzzer. Reopen this game in the same browser to reconnect automatically.</p>
      <Button variant="primary" disabled={busy||!name.trim()||!g.players.some(t=>t.id===teamId)}>{busy?'Joining…':'Join team'}<ArrowRight size={22}/></Button>
    </form>}</main>}
  </div>;
}
function PlayerGame({id,rejoin}:{id:string;rejoin:()=>void}){
  const{g,connected,error,deleted,command}=useGame(id,'player');
  const[leaving,setLeaving]=useState(false);
  const now=useNow(),self=g?.players.find(p=>p.id===g.selfId),c=g?.current;
  const lobby=g?.status==='lobby',selected=!!self&&c?.phase==='question'&&!g?.currentQuestion?.dailyDouble&&!c.closed&&!c.revealAt&&c.answeringId===self.id;
  const blocked=!!self&&self.blockedUntil>now,attempted=!!self&&c?.attempted.includes(self.id),already=!!self&&c?.buzzes.some(b=>b.playerId===self.id);
  const canBuzz=!!g&&connected&&g.status==='playing'&&!g.paused&&!g.currentQuestion?.dailyDouble&&(c?.phase==='question'||c?.phase==='modifier')&&!c.closed&&!c.revealAt&&(c.phase==='modifier'||!blocked)&&!attempted&&!already&&c.buzzOpen;
  const press=()=>{
    if(!g||!self||!connected)return;
    if(lobby){void command('ready',{ready:!self.ready});return;}
    if(canBuzz){navigator.vibrate?.(25);void command('buzz');}
  };
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if(e.code==='Space'&&!e.repeat&&!(e.target as HTMLElement).closest('input,textarea,select,button,a,summary,[contenteditable="true"]')){e.preventDefault();press();}};
    document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
  },[command,canBuzz,lobby,self?.ready]);
  if(deleted)return <LoadError error={error}/>;
  if(error)return <div className="join-page" style={g?themeStyle(g.theme):undefined}><header><Logo/></header><main className="rejoin-message"><p role="alert">{error}</p><Button onClick={rejoin}>Join again</Button></main></div>;
  if(!g)return <LoadError error=""/>;
  if(!self)return <LoadError error="Team not found"/>;
  const member=g.members.find(m=>m.id===g.selfMemberId);
  const label=lobby?(self.ready?'Team ready':'Our team is ready'):g.status==='finished'?'Finished':g.paused?'Paused':c?.closed||c?.revealAt?'Stand by':selected?'Your turn':blocked?`${Math.ceil((self.blockedUntil-now)/1000)}s`:attempted?'Wait':already?'Queued':canBuzz?'Buzz':'Stand by';
  return <div className="player-app" style={themeStyle(g.theme)}>
    <header className="player-header"><AppLink href="/play" aria-label="Back to games"><ArrowLeft/></AppLink><span>{g.name}</span><Connection connected={connected}/><Button disabled={!connected||leaving} onClick={async()=>{setLeaving(true);if(await command('leaveGame'))rejoin();else setLeaving(false);}}><LogOut size={18}/>{leaving?'Leaving…':'Leave game'}</Button></header>
    <main className="player-main">
      <p className="player-team-identity">{member?.name} · <strong>{self.name}</strong></p>
      {g.status==='finished'?(g.rounds[g.roundIndex].type==='final'?<FinalResults g={g}/>:<Scores g={g}/>):<div className="my-score"><strong>{number(self.score)}</strong><span>points</span></div>}
      {g.status==='finished'?null:g.status==='playing'&&g.rounds[g.roundIndex].type==='final'&&!c?<FinalCategories g={g}/>:g.status==='playing'&&g.rounds[g.roundIndex].type==='final'&&c?<FinalSubmission key={`${c.questionId}:${c.phase}`} g={g} connected={connected} command={command}/>:<div className="buzz-area"><button aria-label={lobby?(self.ready?'Mark team not ready':'Mark team ready'):'Buzz in'} aria-pressed={lobby?self.ready:undefined} className={`buzz-button ${selected||lobby&&self.ready?'has-floor':''}`} disabled={!connected||!lobby&&!canBuzz} onPointerDown={e=>{if(connected&&(lobby||canBuzz)){e.preventDefault();press();}}} onClick={e=>{if(e.detail===0)press();}}><Hand strokeWidth={1.2}/><span>{label}</span></button></div>}
    </main>
  </div>;
}

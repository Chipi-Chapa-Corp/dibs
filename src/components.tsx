import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {AppLink} from './navigation';
import type {ButtonHTMLAttributes,ReactNode} from 'react';
import {X,Check,Volume2,VolumeX,Maximize,Upload,Link,ArrowRight,Minus} from 'lucide-react';
import type {GameView,Question} from '../shared/model';
import {dailyDoubleStep} from '../shared/daily-double';
import {isQuestionFilled,roundName} from '../shared/model';
import {useSoundCues} from './useSoundCues';
import {api,copy,number,sortedPlayers,useNow,useToast,themeStyle} from './lib';
export function Button({children,variant='',className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:string}){return <button className={`button ${variant} ${className}`} {...props}>{children}</button>}
export function IconButton({title,children,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{title:string}){return <button className="icon-button" title={title} aria-label={title} {...props}>{children}</button>}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){const ref=useRef<HTMLDivElement>(null);useEffect(()=>{const before=document.activeElement as HTMLElement;const old=document.body.style.overflow;document.body.style.overflow='hidden';ref.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const els=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]')||[]).filter(el=>el.offsetParent!==null);if(!els.length)return;if(e.shiftKey&&document.activeElement===els[0]){e.preventDefault();els.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===els.at(-1)){e.preventDefault();els[0].focus();}}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',key);before?.focus();};},[]);return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide?'wide':''}`}><div className="modal-header"><h2>{title}</h2><IconButton title="Close" onClick={onClose}><X/></IconButton></div>{children}</div></div>}
export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}){return <label className="field"><span>{label}</span>{children}{hint&&<span className="field-hint">{hint}</span>}</label>}
export function Checkbox({label,checked,onChange,disabled=false}:{label:string;checked:boolean;onChange:(value:boolean)=>void;disabled?:boolean}){return <label className="checkbox-control"><span className="checkbox-box"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} disabled={disabled}/><Check size={24} aria-hidden="true"/></span><span>{label}</span></label>}
export function Radio({label,name,checked,onChange}:{label:string;name:string;checked:boolean;onChange:()=>void}){return <label className="radio-control" title={label}><input type="radio" name={name} checked={checked} onChange={onChange}/><span className="visually-hidden">{label}</span></label>}
export function Switch({label,checked,onChange,description,disabled=false}:{label:string;checked:boolean;onChange:(value:boolean)=>void;description?:string;disabled?:boolean}){return <label className="switch-row"><span>{label}{description&&<span className="field-hint">{description}</span>}</span><input type="checkbox" disabled={disabled} checked={checked} onChange={e=>onChange(e.target.checked)}/><span className="switch-track" aria-hidden="true"/></label>}
export function Empty({children}:{children:ReactNode}){return <div className="empty">{children}</div>}
export function Logo(){return <AppLink href="/" className="wordmark">dibs<span>↗</span></AppLink>}
export function Connection({connected}:{connected:boolean}){return <span className={`connection ${connected?'':'offline'}`}><i/>{connected?'Live':'Reconnecting'}</span>}
const MarkdownView=lazy(()=>import('./Markdown'));
export function RichText({text,className=''}:{text:string;className?:string}){return <Suspense fallback={<div className={className}>{text}</div>}><MarkdownView text={text} className={className}/></Suspense>}
export function AnswerChoices({question}:{question:Question}){const options=question.answerOptions?.filter(option=>option.trim());if(question.modifier||question.responseType==='free'||!options||options.length<2)return null;return <ol className="answer-choices" aria-label="Answer choices">{options.map((option,i)=><li key={i}><span>{String.fromCharCode(65+i)}</span><RichText text={option}/></li>)}</ol>}
export function Board({g,onSelect,editable=false,onEdit}:{g:GameView;onSelect?:(q:Question)=>void;editable?:boolean;onEdit?:(q:Question,categoryId:string)=>void}){
  const r=g.rounds[g.roundIndex];if(!r)return null;
  const questionColumns=Math.max(1,...r.categories.map(c=>c.questions.length));
  return <div className={`board-scroll ${!g.theme.motion?'no-motion':''}`}><div className={`board ${g.selection?'is-selecting':''} ${editable?'editor-board':''}`} style={{'--question-columns':questionColumns}as React.CSSProperties}>
    {r.categories.map(c=><div key={c.id} className={`board-row ${c.questions.some(q=>q.id===g.selection?.questionId)?'selected-category':''}`} role="group" aria-label={c.name}>
      <div className="board-category" title={c.name}><span>{c.name}</span></div>
      {Array.from({length:questionColumns},(_,index)=>{
        const q=c.questions[index];if(!q)return <div key={`empty-${index}`} className="board-gap" aria-hidden="true"/>;
        const played=g.played.includes(q.id),empty=g.role==='host'?!isQuestionFilled(q):!g.filledQuestionIds.includes(q.id);
        return <button key={q.id} aria-label={`${c.name}, ${q.value}${empty?', No question':''}${played?', played':''}`} className={`board-cell ${played?'played':''} ${empty?'unwritten':''} ${g.selection?.questionId===q.id?'selecting':''}`} disabled={!editable&&(!onSelect||played||empty||!!g.selection)} onClick={()=>editable?onEdit?.(q,c.id):onSelect?.(q)}>{played&&!editable?<span className="played-mark">—</span>:<><span>{empty&&!editable?'No question':number(q.value)}</span>{editable&&<i className={isQuestionFilled(q)?'filled':''}/>}</>}</button>;
      })}
    </div>)}
  </div></div>;
}
export function HostDailyDoubleStatus({g}:{g:GameView}){
  const c=g.current!,step=dailyDoubleStep(c),from=g.players.find(p=>p.id===c.dailyDoubleFromId),team=g.players.find(p=>p.id===c.answeringId),entry=team?c.wagers[team.id]:undefined;
  const hostTurn=['chooser','open','result'].includes(step),actor=hostTurn?'Presenter':step==='opponent'?from?.name:team?.name;
  const yours=hostTurn;
  const titles={chooser:'Who chose this question?',opponent:`Who does ${from?.name} choose?`,wager:`Record ${team?.name}’s wager.`,open:'Ready to open.',answer:`${team?.name} answers.`,result:entry?.judged?(entry.correct?'Correct!':'Incorrect.'):'Answer judged.'};
  return <div className={`daily-double-status dd-step-${step}`} role="status"><span className={`dd-turn ${yours?'is-yours':''}`}>{yours?'Your turn':`${actor}’s turn`}</span><strong>{titles[step]}</strong>{from&&team&&<div className="dd-handoff"><span>{from.name}</span><ArrowRight size={22} aria-hidden="true"/><span>{team.name}</span></div>}{entry?.submitted&&<span className="dd-stake">{number(entry.wager)} points</span>}</div>;
}
function DailyDoubleDetails({g}:{g:GameView}){
  const c=g.current!,from=g.players.find(p=>p.id===c.dailyDoubleFromId),team=g.players.find(p=>p.id===c.answeringId),entry=team?c.wagers[team.id]:undefined;
  if(!from&&!team)return null;
  return <div className="dd-stage-details">{(from||team)&&<div className="dd-stage-teams">{from&&<span><i className="player-marker" style={{background:from.color}}/>{from.name}</span>}{from&&team&&<ArrowRight aria-hidden="true"/>}{team&&<strong><i className="player-marker" style={{background:team.color}}/>{team.name}</strong>}</div>}{entry?.submitted&&<div className="dd-stage-wager"><strong>{number(entry.wager)}</strong><span>points</span></div>}</div>;
}
function DailyDoubleStage({g}:{g:GameView}){
  return <section className="dd-stage-intro" aria-label="Daily Double"><h1>Daily Double</h1><DailyDoubleDetails g={g}/></section>;
}
export function Scores({g,onAdjust,compact=false,creationOrder=false}:{g:GameView;onAdjust?:(id:string)=>void;compact?:boolean;creationOrder?:boolean}){const sorted=sortedPlayers(g.players),displayed=creationOrder?g.players:sorted;return <div className={`scores ${compact?'compact':''}`}>{displayed.map((p,i)=><button key={p.id} className={`score-person ${g.current?.answeringId===p.id?'answering':''}`} disabled={!onAdjust} onClick={()=>onAdjust?.(p.id)}><span className="score-rank">{String(sorted.findIndex(x=>x.score===p.score)+1).padStart(2,'0')}</span><i className="player-marker" style={{background:p.color}}/><span className="score-name">{p.name}{p.id===g.selfId&&<span className="you-label">Your team</span>}</span><strong>{number(p.score)}</strong></button>)}</div>}
export function QR({value,size=180}:{value:string;size?:number}){
  const[result,setResult]=useState<{value:string;src:string}|null>(null);
  useEffect(()=>{
    let active=true;
    import('qrcode').then(({default:QRCode})=>QRCode.toDataURL(value,{width:size,margin:1,color:{dark:'#252620',light:'#fffdf6'}}))
      .then(src=>{if(active)setResult({value,src});}).catch(()=>{if(active)setResult({value,src:''});});
    return()=>{active=false;};
  },[value,size]);
  return result?.value===value?(result.src?<img className="qr" src={result.src} alt="Scan to open the game list" width={size} height={size}/>:<p role="alert">Could not generate the QR code. Open the link below instead.</p>):null;
}
export function Invite({onClose,title='Invite'}:{onClose:()=>void;title?:string}){
  const[network,set]=useState<string[]|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const toast=useToast();
  useEffect(()=>{
    let active=true;
    set(null);setError('');
    api<{addresses:string[]}>('/api/network').then(n=>{
      if(!active)return;
      const addresses=n.addresses.filter(address=>{
        try{const url=new URL(address);return url.protocol==='http:'&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname);}catch{return false;}
      });
      set(addresses);
    }).catch(()=>{if(active)setError('Could not load the Wi-Fi address. Check your connection and try again.');});
    return()=>{active=false;};
  },[attempt]);
  const url=network?.[0]?`${network[0]}/play`:null;
  return <Modal title={title} onClose={onClose}>
    {url?<><div className="invite-layout"><QR value={url} size={220}/><div><p>Connect to the same Wi-Fi, open the game list and tap Join next to your game. Each teammate can join the same team on their own phone.</p><p className="invite-url">{url}</p><Button variant="primary" onClick={()=>{void copy(url);toast('Game list link copied');}}><Link size={20}/>Copy game list link</Button></div></div>{network&&network.length>1&&<details><summary>Other network addresses</summary>{network.slice(1).map(base=><p key={base}>{base}/play</p>)}</details>}</>
      :<><p role={error?'alert':'status'}>{error||(!network?'Finding the Wi-Fi address…':'No Wi-Fi address found. Connect this computer to your local network, then restart the dev server and try again.')}</p>{(error||network)&&<div className="modal-actions"><Button onClick={()=>setAttempt(n=>n+1)}>Try again</Button></div>}</>}
  </Modal>;
}

export function UploadMedia({id,editorId,onInsert}:{id:string;editorId:string;onInsert:(value:string)=>void}){const ref=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false);const toast=useToast();return <><Button onClick={()=>ref.current?.click()} disabled={busy}><Upload size={18}/>{busy?'Uploading…':'Add media'}</Button><input ref={ref} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setBusy(true);try{const form=new FormData();form.append('file',file);const res=await fetch(`/api/games/${id}/media`,{method:'POST',headers:{'X-Editor-Id':editorId},body:form});const result=await res.json();if(!res.ok)throw new Error(result.error);const markup=result.type.startsWith('image/')?`![${file.name.replace(/[\[\]]/g,'')}](${result.url})`:result.type.startsWith('video/')?`[Video](${result.url})`:`[Audio](${result.url})`;onInsert('\n\n'+markup+'\n');toast('Media added');}catch(err){toast((err as Error).message);}finally{setBusy(false);e.target.value='';}}}/></>}
export function StageContent({g,preview=false}:{g:GameView;preview?:boolean}){const c=g.current,q=g.currentQuestion;const correctTeam=c?.closed&&c.answeringId&&!q?.dailyDouble&&g.rounds[g.roundIndex].type==='board'?g.players.find(t=>t.id===c.answeringId):null;const{muted,toggleSound}=useSoundCues(g,'stage',preview);
  useNow();const recent=g.announcement&&Date.now()-g.announcement.at<3500;return <div className={`stage-surface ${!g.theme.motion?'no-motion':''} ${preview?'stage-preview':''}`} style={themeStyle(g.theme)}>{g.theme.background&&<div className="stage-background" style={{backgroundImage:`url(${g.theme.background})`}}/>}<header className="stage-header"><span className="stage-brand">{g.theme.title||g.name}</span><span>{g.status==='finished'?'Final standings':roundName(g.roundIndex)}</span></header>
  {g.status==='finished'?<div className="stage-results"><span className="eyebrow">That’s a wrap</span><h1>{sortedPlayers(g.players).filter(p=>p.score===Math.max(...g.players.map(x=>x.score))).map(p=>p.name).join(' & ')||'Good game.'}<span className="winner-dot">✳</span></h1><Scores g={g} creationOrder/></div>:c?.phase==='modifier'?<ModifierStage g={g}/>:c&&q?<div key={q.id} className={`stage-question ${c.revealed?'answer-visible':''}`}><div className="question-meta"><span>{c.category}</span>{(!q.dailyDouble||c.phase!=='wager')&&<span>{q.dailyDouble?'Daily Double':number(q.value)}</span>}</div>{c.phase==='wager'?q.dailyDouble?<DailyDoubleStage g={g}/>:<div className="wager-stage"><span className="display-star">✳</span><h1>{q.dailyDouble?'Make it count.':'One last wager.'}</h1><p>{Object.keys(c.wagers).length} / {q.dailyDouble?1:g.players.length} wagers in</p></div>:<>{q.dailyDouble&&<DailyDoubleDetails g={g}/>}<div className="stage-question-body"><RichText text={q.prompt}/><AnswerChoices question={q}/></div>{c.revealAt&&!c.revealed&&<div className="reveal-curtain"><span>And the answer is</span><i/></div>}{c.revealed&&<div className="stage-answer">{correctTeam?<span className="eyebrow stage-correct-label"><Check size={28} aria-hidden="true"/>Correct · {correctTeam.name}</span>:<span className="eyebrow">The answer</span>}<RichText text={q.answer}/></div>}{c.answeringId&&!c.revealed&&!q.dailyDouble&&<div className="stage-buzz-name"><i className="player-marker" style={{background:g.players.find(p=>p.id===c.answeringId)?.color}}/>{g.players.find(p=>p.id===c.answeringId)?.name}<span>has the floor</span></div>}</>}</div>:g.status==='lobby'?<div className="stage-waiting"><span className="display-star">✳</span><div><span className="eyebrow">Take your place</span><h1>{g.theme.title||g.name}</h1><div className="stage-players">{g.players.length?g.players.map(p=><span key={p.id}><i className="player-marker" style={{background:p.color}}/>{p.name}</span>):<span>Waiting for teams</span>}</div></div></div>:<div className="stage-board"><Board g={g}/></div>}
  {(g.settings.showLeaderboardOnStage||!!c?.incorrectTeamIds?.length||!!c?.passedTeamIds?.length)&&g.status!=='finished'&&g.players.length>0&&<div className="stage-score-strip" aria-label="Teams">{g.players.map(p=>{const incorrect=c?.incorrectTeamIds?.includes(p.id),passed=c?.passedTeamIds?.includes(p.id);return <div key={p.id} className={[p.id===c?.answeringId?'active':'',incorrect?'incorrect':'',passed?'passed':''].filter(Boolean).join(' ')}><span><i className="player-marker" style={{background:p.color}}/>{p.name}</span>{g.settings.showLeaderboardOnStage&&<strong>{number(p.score)}</strong>}{incorrect?<small className="stage-result-label" role="status"><X size={18} aria-hidden="true"/>Incorrect</small>:passed?<small className="stage-result-label" role="status"><Minus size={18} aria-hidden="true"/>Passed</small>:null}</div>;})}</div>}{g.paused&&<div className="pause-overlay"><span>Intermission.</span></div>}{recent&&<div key={g.announcement!.id} className="announcement"><span>✳</span><div><strong>{g.announcement!.title}</strong><span>{g.announcement!.detail}</span></div></div>}{!preview&&<div className="stage-tools"><IconButton title={muted?'Enable sound':'Mute sound'} aria-pressed={!muted} onClick={toggleSound}>{muted?<VolumeX/>:<Volume2/>}</IconButton><IconButton title="Fullscreen" onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void document.documentElement.requestFullscreen();}}><Maximize/></IconButton></div>}</div>;
}

function ModifierStage({g}:{g:GameView}){
  const c=g.current!,winner=g.players.find(p=>p.id===c.answeringId),modifier=g.currentQuestion?.modifier;
  return <div className="modifier-stage" aria-live="polite"><span className="eyebrow">Mystery modifier</span><span className="display-star">✳</span>
    <h1>{winner?`${winner.name} claimed it`:'First to buzz gets it.'}</h1>
    {c.revealed&&modifier?<div className="modifier-reveal"><h2>{modifier.title}</h2><RichText text={modifier.instructions}/></div>:<p>{winner?'Let’s see what you got…':'Something unexpected is hiding here. Tap your buzzer to claim it.'}</p>}
  </div>;
}

import {useEffect,useState} from 'react';
import {ArrowRight,Check,ChevronDown,X} from 'lucide-react';
import type {GameView} from '../shared/model';
import {ContinueQuestion} from './ContinueQuestion';
import {dailyDoubleStep} from '../shared/daily-double';
import {AnswerChoices,Button,HostDailyDoubleStatus,Field,IconButton,RichText} from './components';

type Command=(action:string,data?:Record<string,unknown>)=>Promise<boolean>;
const validWager=(value:string)=>value.trim()!==''&&Number.isInteger(Number(value))&&Number(value)>=0&&Number(value)<=1e7;

function TeamChoices({g,exclude,disabled,onChoose}:{g:GameView;exclude?:string;disabled:boolean;onChoose:(id:string)=>void}){
  return <div className="dd-team-choices">{g.players.filter(p=>p.id!==exclude).map(p=><Button key={p.id} disabled={disabled} onClick={()=>onChoose(p.id)}><i className="player-marker" style={{background:p.color}}/>{p.name}<ArrowRight size={20}/></Button>)}</div>;
}

export function HostDailyDouble({g,command}:{g:GameView;command:Command}){
  const c=g.current!,q=g.currentQuestion!,step=dailyDoubleStep(c);
  const from=g.players.find(p=>p.id===c.dailyDoubleFromId),team=g.players.find(p=>p.id===c.answeringId),entry=team?c.wagers[team.id]:undefined;
  const[wager,setWager]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>setWager(entry?String(entry.wager):''),[c.answeringId,entry?.wager]);
  const disabled=g.paused||busy;
  const run=async(action:string,data?:Record<string,unknown>)=>{setBusy(true);try{return await command(action,data);}finally{setBusy(false);}};
  const choose=(playerId:string)=>{void run('setDailyDoubleChooser',{playerId});};
  return <div className="host-question daily-double">
    <div className="question-meta"><span>{c.category}</span><span>Daily Double</span><IconButton title="Close question" onClick={()=>void run('closeQuestion')} disabled={busy}><X/></IconButton></div>
    <HostDailyDoubleStatus g={g}/>
    {step==='chooser'&&<>{g.players.length<2?<p className="dd-notice">Add another team to play.</p>:<TeamChoices g={g} disabled={disabled} onChoose={choose}/>}</>}
    {step==='opponent'&&from&&<TeamChoices g={g} exclude={from.id} disabled={disabled} onChoose={playerId=>void run('assignDailyDouble',{fromId:from.id,playerId})}/>}
    {step==='wager'&&team&&<><p className="dd-notice">Offer the amounts aloud, then record {team.name}’s choice.</p><form className="dd-wager-form" onSubmit={async e=>{e.preventDefault();if(validWager(wager))await run('hostWager',{playerId:team.id,wager:Number(wager)});}}><Field label="Wager"><input autoFocus type="number" min={0} max={1e7} step={1} value={wager} onChange={e=>setWager(e.target.value)} disabled={disabled}/></Field><Button type="submit" variant="primary" disabled={disabled||!validWager(wager)}>Confirm wager<ArrowRight size={22}/></Button></form></>}
    {step==='open'&&<Button className="dd-primary-action" variant="primary" disabled={disabled} onClick={()=>void run('finalBegin')}>Open question<ArrowRight size={22}/></Button>}
    {(step==='answer'||step==='result')&&<>
      <div className="host-clue"><RichText text={q.prompt}/><AnswerChoices question={q}/></div>
      <div className="dd-answer"><h3>Answer</h3><RichText text={q.answer}/></div>
      <div className="team-result-buttons dd-judging" role="group" aria-label={`Result for ${team?.name}`}><Button className="result-correct" aria-pressed={entry?.judged&&entry.correct===true} disabled={disabled} onClick={()=>void run('gradeTeam',{questionId:c.questionId,playerId:team!.id,result:'correct'})}><Check size={20}/>Correct</Button><Button className="result-incorrect" aria-pressed={entry?.judged&&entry.correct===false} disabled={disabled} onClick={()=>void run('gradeTeam',{questionId:c.questionId,playerId:team!.id,result:'incorrect'})}><X size={20}/>Incorrect</Button></div>{step==='result'&&<ContinueQuestion g={g} command={run}/>}
    </>}
    {c.phase==='wager'&&<details className="dd-preview"><summary>Preview question & answer<ChevronDown size={20}/></summary><RichText text={q.prompt}/><AnswerChoices question={q}/><h3>Answer</h3><RichText text={q.answer}/>{q.notes&&<><h3>Notes</h3><RichText text={q.notes}/></>}</details>}
    {q.notes&&c.phase!=='wager'&&<details className="dd-preview"><summary>Notes<ChevronDown size={20}/></summary><RichText text={q.notes}/></details>}
    {c.phase==='wager'&&step!=='chooser'&&<details className="dd-corrections" key={`${c.dailyDoubleFromId}:${c.answeringId}`}><summary>Change<ChevronDown size={20}/></summary>
      <h3>Choosing team</h3><TeamChoices g={g} disabled={disabled} onChoose={choose}/>
      {from&&step!=='opponent'&&<><h3>Opponent</h3><TeamChoices g={g} exclude={from.id} disabled={disabled} onChoose={playerId=>void run('assignDailyDouble',{fromId:from.id,playerId})}/></>}
      {team&&step==='open'&&<form className="dd-wager-form" onSubmit={async e=>{e.preventDefault();if(validWager(wager))await run('hostWager',{playerId:team.id,wager:Number(wager)});}}><Field label={`Wager for ${team.name}`}><input type="number" min={0} max={1e7} step={1} value={wager} onChange={e=>setWager(e.target.value)} disabled={disabled}/></Field><Button type="submit" disabled={disabled||!validWager(wager)}>Save wager<Check size={20}/></Button></form>}
    </details>}
  </div>;
}

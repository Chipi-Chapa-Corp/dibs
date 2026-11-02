import {useEffect,useState} from 'react';
import {ArrowRight,Check,X} from 'lucide-react';
import type {GameView} from '../shared/model';
import {number} from './lib';
import {AnswerChoices,Button,DailyDoubleStatus,Field,IconButton,RichText} from './components';

type Command=(action:string,data?:Record<string,unknown>)=>Promise<boolean>;
export function HostDailyDouble({g,command}:{g:GameView;command:Command}){
  const c=g.current!,q=g.currentQuestion!;
  const[from,setFrom]=useState(c.dailyDoubleFromId||''),[to,setTo]=useState(c.answeringId||''),[wager,setWager]=useState('');
  const team=g.players.find(p=>p.id===c.answeringId),entry=team?c.wagers[team.id]:undefined;
  useEffect(()=>{setFrom(c.dailyDoubleFromId||'');setTo(c.answeringId||'');},[c.dailyDoubleFromId,c.answeringId]);
  useEffect(()=>setWager(entry?String(entry.wager):''),[c.answeringId,entry?.wager]);
  const validWager=wager.trim()!==''&&Number.isInteger(Number(wager))&&Number(wager)>=0&&Number(wager)<=1e7;
  return <div className="host-question">
    <div className="question-meta"><span>{c.category}</span><span>Daily Double</span><IconButton title="Return to board" onClick={()=>void command('closeQuestion')}><X/></IconButton></div>
    {c.phase==='wager'?<div className="daily-double-console">
      <h2>Give it to another team.</h2><p>Record who selected the question and which opposing team they give it to. That team must answer.</p>
      {g.players.length<2&&<p role="status">Add at least two teams to play this Daily Double.</p>}
      <form onSubmit={e=>{e.preventDefault();void command('assignDailyDouble',{fromId:from,playerId:to});}}>
        <div className="form-grid"><Field label="Selected by"><select value={from} onChange={e=>{setFrom(e.target.value);if(to===e.target.value)setTo('');}}><option value="">Choose selecting team</option>{g.players.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Must answer"><select value={to} onChange={e=>setTo(e.target.value)}><option value="">Choose another team</option>{g.players.filter(p=>p.id!==from).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></div>
        <Button type="submit" disabled={g.paused||!from||!to||from===to||from===c.dailyDoubleFromId&&to===c.answeringId}>Confirm teams</Button>
      </form>
      {team&&c.dailyDoubleFromId&&<>
        <div className="daily-double-assignment"><strong>{team.name} must answer.</strong><p>Give the wager options verbally. {team.name} chooses one and enters it on their phone, or you can record it below.</p></div>
        <form className="inline-form" onSubmit={e=>{e.preventDefault();void command('hostWager',{playerId:team.id,wager:Number(wager)});}}><Field label="Chosen wager"><input type="number" min={0} max={1e7} step={1} value={wager} onChange={e=>setWager(e.target.value)}/></Field><Button type="submit" disabled={g.paused||!validWager}>{entry?'Update wager':'Record wager'}</Button></form>
        <p role="status">{entry?`${number(entry.wager)} points chosen · confirm this matches an option you offered.`:`Waiting for ${team.name} to choose a wager.`}</p>
        <Button variant="primary" disabled={g.paused||!entry?.submitted} onClick={()=>void command('finalBegin')}>Lock wager & open question<ArrowRight size={20}/></Button>
      </>}
    </div>:<>
      <div className="daily-double-assignment"><strong>{team?.name||'Assigned team'} must answer.</strong><span>{number(entry?.wager||0)} points at stake</span></div>
      <div className="host-clue"><RichText text={q.prompt}/><AnswerChoices question={q}/></div>
      <div className="judging-console"><span>{c.closed?'Answer judged':`${team?.name||'Assigned team'} has the floor`}</span><div className="judge-buttons"><Button disabled={g.paused||c.closed||!team} onClick={()=>void command('judge',{correct:false})}><X size={24}/>Incorrect / no answer</Button><Button variant="primary" disabled={g.paused||c.closed||!team} onClick={()=>void command('judge',{correct:true})}><Check size={24}/>Correct</Button></div></div>
    </>}
    <div className="host-answer"><div className="answer-heading"><span className="eyebrow">{c.phase==='wager'?'Host preview':'Answer · host only'}</span>{c.phase!=='wager'&&<Button disabled={!!c.revealAt} onClick={()=>void command('reveal')}>{c.revealed?'Revealed':'Reveal answer'}</Button>}</div>{c.phase==='wager'&&<><RichText text={q.prompt}/><AnswerChoices question={q}/><hr/></>}<RichText text={q.answer}/>{q.notes&&<div className="host-notes"><RichText text={q.notes}/></div>}</div>
    <div className="question-next"><Button onClick={()=>void command('closeQuestion')}>Back to board<ArrowRight size={20}/></Button></div>
  </div>;
}

export function PlayerDailyDouble({g,command}:{g:GameView;command:Command}){
  const c=g.current!,q=g.currentQuestion!,selected=c.answeringId===g.selfId;
  const[wager,setWager]=useState('');
  const valid=wager.trim()!==''&&Number.isInteger(Number(wager))&&Number(wager)>=0&&Number(wager)<=1e7;
  return <section className="phone-daily-double"><DailyDoubleStatus g={g}/>
    {c.phase==='wager'&&selected&&!g.yourFinal&&<form className="player-wager" onSubmit={e=>{e.preventDefault();void command('wager',{wager:Number(wager)});}}><Field label="Your chosen wager" hint="Enter one of the amounts the presenter offered verbally."><input type="number" min={0} max={1e7} step={1} value={wager} onChange={e=>setWager(e.target.value)}/></Field><Button variant="primary" disabled={!valid||g.paused}>Send choice to presenter<ArrowRight size={20}/></Button></form>}
    {c.phase==='wager'&&selected&&g.yourFinal&&<p className="submitted">Choice sent. The presenter will confirm it and open the question.</p>}
    {c.phase!=='wager'&&<>
      {g.settings.showQuestionOnPhone&&<div className="phone-question"><RichText text={q.prompt}/><AnswerChoices question={q}/></div>}
      {c.revealed?<div className="phone-answer"><span className="eyebrow">Answer</span><RichText text={q.answer}/></div>:<p>{selected?'Your team must answer aloud.':'The assigned team answers this question.'}</p>}
    </>}
  </section>;
}

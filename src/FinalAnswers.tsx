import {useState} from 'react';
import type {GameView} from '../shared/model';
import {Button} from './components';
import {FinalOverride} from './FinalSubmission';
import {TeamJudging} from './TeamJudging';
import {ContinueQuestion} from './ContinueQuestion';
import {number} from './lib';

type Command=(action:string,data?:Record<string,unknown>)=>Promise<boolean>;
export function FinalAnswers({g,command}:{g:GameView;command:Command}){
  const[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),c=g.current!;
  if(c.answersLocked)return <><TeamJudging g={g} command={command}/><ContinueQuestion g={g} command={command}/></>;
  const missing=g.players.filter(t=>!c.wagers[t.id]?.answerSubmitted);
  const lock=async()=>{setBusy(true);try{await command('lockFinalAnswers',{questionId:c.questionId});}finally{setBusy(false);setConfirm(false);}};
  return <section className="final-answers"><h2>Team answers</h2>
    {g.players.map(team=>{const entry=c.wagers[team.id];return <div className="final-host-team" key={team.id}>
      <div className="final-wager-row"><span><i className="player-marker" style={{background:team.color}}/>{team.name}</span><strong>{number(entry?.wager||0)} wager</strong></div>
      <p className="final-answer-text">{entry?.answerSubmitted?entry.answer:'Waiting for an answer…'}</p>
      <FinalOverride g={g} teamId={team.id} command={command}/>
    </div>;})}
    {confirm?<div className="final-lock-confirm" role="alert"><p>No saved answer from {missing.map(t=>t.name).join(', ')}. Lock anyway?</p><Button disabled={busy||g.paused} onClick={()=>void lock()}>Lock answers anyway</Button><Button disabled={busy} onClick={()=>setConfirm(false)}>Cancel</Button></div>:<Button variant="primary" disabled={busy||g.paused} onClick={()=>{if(missing.length)setConfirm(true);else void lock();}}>{busy?'Locking…':'Lock answers'}</Button>}
  </section>;
}

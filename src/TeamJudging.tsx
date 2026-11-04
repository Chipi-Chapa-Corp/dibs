import {useState} from 'react';
import {Check,X} from 'lucide-react';
import type {GameView,TeamResult} from '../shared/model';
import {number} from './lib';
import {FinalOverride} from './FinalSubmission';
import {Button} from './components';

type Command=(action:string,data?:Record<string,unknown>)=>Promise<boolean>;
const results:{value:TeamResult;label:string;icon:typeof Check}[]=[
  {value:'correct',label:'Correct',icon:Check},
  {value:'incorrect',label:'Incorrect',icon:X},
];
export function TeamJudging({g,command}:{g:GameView;command:Command}){
  const[busy,setBusy]=useState(false);
  const current=g.current!,final=g.rounds[g.roundIndex].type==='final';
  return <section className="team-judging" aria-label="Team results"><h3>Team results</h3>
    {g.players.map(team=>{
      const judgment=current.judgments?.[team.id],entry=current.wagers[team.id];
      const legacy=final?entry?.judged?entry.correct?'correct':'incorrect':'pass':current.attempted.includes(team.id)?current.closed&&current.answeringId===team.id?'correct':'incorrect':'pass';
      const result=judgment?.result||legacy;
      return <div className={`team-result-row ${current.answeringId===team.id?'is-answering':''}`} key={team.id}>
        <div className="team-result-identity"><span className="team-result-name"><i className="player-marker" style={{background:team.color}}/>{team.name}</span>
          {current.answeringId===team.id&&!current.closed&&<span className="field-hint">Answering</span>}
          {final&&<><span className="field-hint">{number(entry?.wager||0)} wager</span><p className="final-answer-text">{entry?.answerSubmitted||entry?.answer?entry.answer:'No answer'}</p><FinalOverride g={g} teamId={team.id} command={command}/></>}
        </div>
        <div className="team-result-buttons" role="group" aria-label={`Result for ${team.name}`}>
          {results.map(({value,label,icon:Icon})=><Button key={value} className={`result-${value}`} aria-pressed={result===value} title={label} disabled={busy||g.paused} onClick={async()=>{setBusy(true);try{await command('gradeTeam',{questionId:current.questionId,playerId:team.id,result:value});}finally{setBusy(false);}}}><Icon size={18}/>{label}</Button>)}
        </div>
      </div>;
    })}
  </section>;
}

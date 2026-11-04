import {useEffect,useRef,useState} from 'react';
import {Check,Hand,X} from 'lucide-react';
import type {GameView} from '../shared/model';
import {hasCorrectResult} from '../shared/model';
import {number} from './lib';
import {Button} from './components';
import {ContinueQuestion} from './ContinueQuestion';

type Command=(action:string,data?:Record<string,unknown>)=>Promise<boolean>;
export function AnswerDecision({g,command}:{g:GameView;command:Command}){
  const current=g.current!,question=g.currentQuestion!,team=g.players.find(t=>t.id===current.answeringId);
  const award=Math.round(question.value*g.settings.correctMultiplier),penalty=g.settings.deductWrong?Math.round(question.value*g.settings.wrongMultiplier):0;
  const[busy,setBusy]=useState(false),panel=useRef<HTMLElement>(null);
  useEffect(()=>{if(team&&!current.closed)panel.current?.scrollIntoView({block:'end',behavior:'auto'});},[team?.id,current.answerToken]);
  const exhausted=g.players.every(t=>current.attempted.includes(t.id));
  const resolve=async(result:'correct'|'incorrect')=>{
    if(!team)return;
    setBusy(true);
    try{await command('resolveAnswer',{questionId:current.questionId,playerId:team.id,answerToken:current.answerToken,result});}finally{setBusy(false);}
  };
  if(current.closed||current.revealed||current.revealAt!==null)return <section ref={panel} className="answer-decision" aria-label="Answer decision">
    {hasCorrectResult(current)?<><span className="eyebrow">Correct answer</span><h2><Check size={28}/>{team?.name}</h2></>:<h2>Question ended</h2>}
    <p>The answer stays on the presenter screen until you continue.</p>
    <ContinueQuestion g={g} command={command}/>
  </section>;
  return <section ref={panel} className="answer-decision" aria-label="Answer decision">
    {team&&!current.closed&&!current.revealed&&current.revealAt===null?<>
      <span className="eyebrow">Answering now</span><h2><i className="player-marker" style={{background:team.color}}/>{team.name}</h2>
      <p>Correct reveals the answer. Incorrect lets the remaining teams buzz.</p>
      <div className="answer-decision-buttons"><Button variant="primary" disabled={busy||g.paused} onClick={()=>void resolve('correct')}><Check size={22}/>Correct · +{number(award)}</Button><Button disabled={busy||g.paused} onClick={()=>void resolve('incorrect')}><X size={22}/>Incorrect · −{number(penalty)}</Button></div>
    </>:<div className="waiting-for-buzz"><Hand size={28}/><h2>{current.revealed||current.revealAt!==null?'Answer already revealed':exhausted?'No teams left to answer':g.paused?'Game paused':'Waiting for the first buzz'}</h2><p>{current.revealed||current.revealAt!==null?'End this question to return to the board.':exhausted?'End this question and choose the next one.':g.paused?'Resume the game to accept buzzes.':'Buzzers are open for teams that have not answered yet.'}</p></div>}
    <div className="question-next"><span className="field-hint">{current.attempted.length>0?`${current.attempted.length} ${current.attempted.length===1?'team is':'teams are'} out for this question.`:''}</span><Button disabled={busy||g.paused} onClick={async()=>{setBusy(true);try{await command('endQuestion',{questionId:current.questionId});}finally{setBusy(false);}}}>End question</Button></div>
  </section>;
}

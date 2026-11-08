import {useEffect,useState} from 'react';
import type {CSSProperties} from 'react';
import {Trophy} from 'lucide-react';
import type {GameView} from '../shared/model';
import {number,useNow} from './lib';
import {RichText} from './components';
import {FINAL_ANSWER_MS,RESULTS_COUNTDOWN_MS,resultGroups,resultRevealAt,resultStep} from './final-results';

export function FinalResults({g,preview=false}:{g:GameView;preview?:boolean}){
  const now=useNow(),[clockOffset]=useState(()=>g.serverTime-Date.now());
  const[reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(media.matches);
    media.addEventListener('change',change);return()=>media.removeEventListener('change',change);
  },[]);
  const groups=resultGroups(g.players),finishedAt=g.history.find(entry=>entry.label==='Game finished')?.at;
  // Use the server's finish time so every display stays in sync, including after a refresh.
  const elapsed=g.resultsSkipped||reduced||!g.theme.motion||preview||!finishedAt?Infinity:Math.max(0,now+clockOffset-finishedAt);
  const finalAnswer=g.rounds[g.roundIndex].type==='final'?g.currentQuestion?.answer:undefined;
  const resultsElapsed=elapsed-(finalAnswer?FINAL_ANSWER_MS:0),showAnswer=resultsElapsed<0;
  const step=resultStep(resultsElapsed,groups.length),active=groups[step],winner=!!active&&step===groups.length-1;
  const celebrating=winner&&resultsElapsed-resultRevealAt(step,groups.length)<4500;
  const countdown=Math.max(1,Math.ceil((RESULTS_COUNTDOWN_MS-resultsElapsed)/1000));
  if(!groups.length)return <section className="finale"><h1>Good game.</h1></section>;
  return <section className={`finale ${winner?'finale-winner':''}`} aria-label="Final results">
    {celebrating&&<div className="finale-confetti" aria-hidden="true">{Array.from({length:36},(_,i)=><i key={i} style={{'--x':`${(i*37)%100}%`,'--drift':`${((i*53)%240)-120}px`,'--delay':`${(i%9)*.09}s`,'--turn':`${180+(i%5)*90}deg`,background:[g.theme.accent,'#b4934d',g.theme.ink,g.theme.muted][i%4]} as CSSProperties}/>)}</div>}
    <div className="finale-spotlight" aria-live="polite" aria-atomic="true">
      {showAnswer?<div className="finale-answer"><span className="eyebrow">The final answer</span><RichText text={finalAnswer!}/></div>:active?<div key={active.rank} className="finale-place">
        <span className="eyebrow">{winner?(active.teams.length>1?'Joint winners':'The winner'):active.teams.length>1?`Tied for ${active.rank}${active.rank===2?'nd':active.rank===3?'rd':'th'} place`:`${active.rank}${active.rank===2?'nd':active.rank===3?'rd':'th'} place`}</span>
        {winner&&<Trophy className="finale-trophy" size={48} aria-hidden="true"/>}
        <h1>{active.teams.map(team=>team.name).join(' & ')}</h1>
        <div className="finale-points"><strong>{number(active.score)}</strong><span>points</span></div>
        {finalAnswer&&<div className="finale-submissions">{active.teams.map(team=>{const entry=g.current?.wagers[team.id];return entry?<div key={team.id}><strong>{team.name}</strong><p>{entry.answer||'No answer'}</p><span>{number(entry.wager)} wager · {entry.correct?'Correct':'Incorrect'}</span></div>:null;})}</div>}
        {!winner&&<div className="finale-next" aria-hidden="true"><i key={step}/></div>}
      </div>:<div className="finale-countdown">
        <span className="eyebrow">The results are in</span>
        <div className="finale-countdown-dial"><span key={countdown}>{countdown}</span><i aria-hidden="true"/></div>
        <p>Every point counted.</p>
      </div>}
    </div>
    {finalAnswer&&!showAnswer&&<div className="finale-answer-summary"><span className="eyebrow">Final answer</span><RichText text={finalAnswer}/></div>}
    <div className="finale-teams" aria-label="Team standings">
      {g.players.map(team=>{
        const index=groups.findIndex(group=>group.score===team.score),visible=index<=step,isWinner=visible&&groups[index].rank===1;
        return <div className={`finale-team ${visible?'is-revealed':''} ${isWinner?'is-winner':''}`} key={team.id}>
          <span className="finale-team-name"><i className="player-marker" style={{background:team.color}}/>{team.name}</span>
          {visible?<div className="finale-team-result"><span>#{groups[index].rank}</span><strong>{number(team.score)}</strong>{finalAnswer&&g.current?.wagers[team.id]&&<><small>{g.current.wagers[team.id].correct?'Correct':'Incorrect'} · {number(g.current.wagers[team.id].wager)} wager</small><p className="finale-team-answer">{g.current.wagers[team.id].answer||'No answer'}</p></>}</div>:<span className="finale-hidden-score" aria-label="Not revealed yet">···</span>}
        </div>;
      })}
    </div>
  </section>;
}

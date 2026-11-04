import {useState} from 'react';
import {ArrowRight,Flag} from 'lucide-react';
import type {GameView} from '../shared/model';
import {hasCorrectResult} from '../shared/model';
import {Button} from './components';

type Command=(action:string,data?:Record<string,unknown>)=>Promise<boolean>;
export function ContinueQuestion({g,command}:{g:GameView;command:Command}){
  const[busy,setBusy]=useState(false),current=g.current!;
  const final=g.rounds[g.roundIndex].type==='final',unjudged=final&&g.players.some(team=>!current.wagers[team.id]?.judged);
  const revealing=current.revealAt!==null&&!current.revealed;
  const willReveal=hasCorrectResult(current)&&!current.revealed;
  const hint=final?(unjudged?'Mark every team Correct or Incorrect before finishing.':'Reveal the final answer and results.'):revealing?'Revealing answer…':willReveal?'Continue will reveal the answer.':current.revealed?'The answer is visible. Continue to the board.':'Continue to the board.';
  return <div className="question-next"><Button type="button" variant={final?'primary':''} disabled={busy||g.paused||revealing||unjudged} title={hint} onClick={async()=>{setBusy(true);try{await command('continueQuestion',{questionId:current.questionId});}finally{setBusy(false);}}}>{final?(busy?'Finishing…':'Finish game'):revealing?'Revealing…':'Continue'}{final?<Flag size={20}/>:<ArrowRight size={20}/>}</Button></div>;
}

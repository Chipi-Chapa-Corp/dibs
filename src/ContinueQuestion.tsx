import {useState} from 'react';
import {ArrowRight} from 'lucide-react';
import type {GameView} from '../shared/model';
import {hasCorrectResult} from '../shared/model';
import {Button} from './components';

type Command=(action:string,data?:Record<string,unknown>)=>Promise<boolean>;
export function ContinueQuestion({g,command}:{g:GameView;command:Command}){
  const[busy,setBusy]=useState(false),current=g.current!;
  const revealing=current.revealAt!==null&&!current.revealed;
  const willReveal=hasCorrectResult(current)&&!current.revealed;
  const hint=revealing?'Revealing answer…':willReveal?'Continue will reveal the answer.':current.revealed?'The answer is visible. Continue to the board.':'Continue to the board.';
  return <div className="question-next"><span className="field-hint" role="status">{hint}</span><Button type="button" disabled={busy||g.paused||revealing} title={hint} onClick={async()=>{setBusy(true);try{await command('continueQuestion',{questionId:current.questionId});}finally{setBusy(false);}}}>{revealing?'Revealing…':'Continue'}<ArrowRight size={20}/></Button></div>;
}

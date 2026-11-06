import {useState} from 'react';
import {ArrowRight,RotateCcw,X} from 'lucide-react';
import type {GameView} from '../shared/model';
import {Button} from './components';

type Command=(action:string,data?:Record<string,unknown>)=>Promise<boolean>;

export function FinalCategories({g,command}:{g:GameView;command?:Command}){
  const[busy,setBusy]=useState(false),round=g.rounds[g.roundIndex];
  const rejected=g.finalCategorySelection?.roundId===round.id?g.finalCategorySelection.rejectedCategoryIds:[];
  const remaining=round.categories.filter(category=>!rejected.includes(category.id));
  const ready=remaining.length===1&&g.filledQuestionIds.includes(remaining[0].questions[0]?.id);
  const run=async(action:string,data:Record<string,unknown>)=>{
    if(!command)return;
    setBusy(true);try{await command(action,{roundId:round.id,...data});}finally{setBusy(false);}
  };
  return <section className="final-category-selection" aria-label="Final category selection">
    <span className="eyebrow">Final</span>
    <h1>{remaining.length===1?'The final category.':'Choose what stays.'}</h1>
    {command&&remaining.length>1&&<p className="field-hint">Ask teams which category they reject, then cross it out.</p>}
    {!round.categories.length&&<p>Add final categories in game preparation.</p>}
    <ul className="final-category-list" aria-live="polite">
      {round.categories.map(category=>{
        const crossed=rejected.includes(category.id),survivor=!crossed&&remaining.length===1;
        return <li key={category.id} className={`${crossed?'is-rejected':''} ${survivor?'is-final-choice':''}`}>
          <span className="final-category-name">{category.name}</span>
          {command?<Button aria-label={`${crossed?'Restore':'Reject'} ${category.name}`} aria-pressed={crossed} disabled={busy||g.paused||survivor} onClick={()=>void run('setFinalCategoryRejected',{categoryId:category.id,rejected:!crossed})}>{crossed?<RotateCcw size={20}/>:<X size={20}/>}<span>{crossed?'Restore':'Reject'}</span></Button>:crossed?<X aria-label="Rejected"/>:null}
        </li>;
      })}
    </ul>
    {command&&<Button variant="primary" disabled={busy||g.paused||!ready} onClick={()=>void run('chooseFinalCategory',{})}>Collect wagers<ArrowRight size={20}/></Button>}
    {command&&remaining.length===1&&!ready&&<p role="alert">The remaining category needs a question before it can be played.</p>}
    {!command&&remaining.length===1&&<p className="field-hint">Waiting for the host to open wagers.</p>}
  </section>;
}

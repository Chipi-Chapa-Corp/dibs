import {useEffect,useRef,useState} from 'react';
import type {FinalEntry,GameView} from '../shared/model';
import {finalWagerLimit} from '../shared/model';
import {Button} from './components';
import {number} from './lib';

type Command=(action:string,data?:Record<string,unknown>)=>Promise<boolean>;

// A version belongs to one shared team field. A stale phone must never silently
// overwrite a teammate's edit, even after reconnecting or a slow acknowledgement.
function useSharedField(value:string,version:number,enabled:boolean,valid:(value:string)=>boolean,save:(value:string,version:number)=>Promise<boolean>){
  const[draft,setDraft]=useState<{value:string;version:number}|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
  const saveRef=useRef(save);saveRef.current=save;
  const text=draft?.value??value,conflict=!!draft&&draft.version!==version;
  const run=async()=>{
    if(!draft||!enabled||busy||conflict||!valid(draft.value))return;
    const sent=draft;setBusy(true);
    try{
      const ok=await saveRef.current(sent.value,sent.version);
      setFailed(!ok);
      if(ok)setDraft(previous=>previous===sent?null:previous?{...previous,version:sent.version+1}:null);
    }finally{setBusy(false);}
  };
  const runRef=useRef(run);runRef.current=run;
  const isValid=valid(text);
  useEffect(()=>{
    if(!draft||!enabled||busy||failed||conflict||!isValid)return;
    const timer=setTimeout(()=>void runRef.current(),600);return()=>clearTimeout(timer);
  },[draft,enabled,busy,failed,conflict,isValid]);
  return{text,busy,conflict,isValid,dirty:!!draft,failed,
    change:(value:string)=>{setFailed(false);setDraft(old=>({value,version:old?.version??version}));},
    reset:()=>{setDraft(null);setFailed(false);},
    keep:()=>{setDraft(old=>old?{...old,version}:old);setFailed(false);},
    retry:()=>{setFailed(false);void run();},
  };
}

export function FinalSubmission({g,connected,command}:{g:GameView;connected:boolean;command:Command}){
  const c=g.current!,entry=g.yourFinal,wager=c.phase==='wager',locked=!wager&&!!c.answersLocked;
  const self=g.players.find(t=>t.id===g.selfId)!;
  const max=finalWagerLimit(self.score,g.settings.finalMaxWager);
  const enabled=connected&&!g.paused&&!locked;
  const field=useSharedField(wager?(entry?String(entry.wager):''):(entry?.answer??''),wager?entry?.wagerVersion||0:entry?.answerVersion||0,enabled,
    value=>wager?!!value.trim()&&Number.isInteger(Number(value))&&Number(value)>=0&&Number(value)<=max:value.length<=5000,
    (value,version)=>command(wager?'wager':'finalAnswer',{questionId:c.questionId,version,...(wager?{wager:Number(value)}:{answer:value})}));
  const saved=wager?entry?.submitted:entry?.answerSubmitted;
  return <section className="phone-final" aria-label="Final submission">
    <span className="eyebrow">Final · {wager?'Wager':locked?'Answers locked':'Answer'}</span>
    <h1>{wager?c.category:locked?'Your answer is locked.':'What’s your answer?'}</h1>
    <p className="field-hint">One shared submission for {self.name}. Only your team and the host can see it.</p>
    {!wager&&<p className="phone-final-wager">Your wager <strong>{number(entry?.wager||0)}</strong></p>}
    <label className="field"><span>{wager?'Team wager':'Team answer'}</span>{wager?<input aria-label="Team wager" type="number" min={0} max={max} inputMode="numeric" value={field.text} disabled={!enabled} onChange={e=>field.change(e.target.value)}/>:<textarea aria-label="Team answer" rows={4} maxLength={5000} value={locked?(entry?.answer??''):field.text} disabled={!enabled} onChange={e=>field.change(e.target.value)} placeholder="Write your team’s answer…"/>}</label>
    {wager&&<p className="field-hint">0–{number(max)} points. You can change it until the host locks wagers.</p>}
    <div className="final-save-status" role="status">{!connected?'Offline — reconnecting. Keep this page open.':g.paused?'Game paused':locked?(field.dirty&&!field.busy?'Locked. Your last edit was not saved; tell the host.':'Saved · waiting for the final reveal'):field.conflict?'A teammate or the host changed this submission.':field.busy?'Saving…':field.failed?'Not saved. Try again.':field.dirty?field.isValid?'Not saved yet…':'Enter a valid wager.':saved?'Saved':wager?'Enter your wager.':'Waiting for your answer.'}</div>
    {field.conflict&&<div className="final-conflict"><p>Saved: <strong>{wager?entry?.wager:entry?.answer||'No answer'}</strong></p><Button onClick={field.reset}>Use saved</Button><Button disabled={!enabled} onClick={field.keep}>Keep my edit</Button></div>}
    {field.failed&&<Button disabled={!enabled||field.busy||!field.isValid||field.conflict} onClick={field.retry}>Retry save</Button>}
  </section>;
}

export function FinalOverride({g,teamId,command}:{g:GameView;teamId:string;command:Command}){
  const c=g.current!,entry=c.wagers[teamId];
  return <details className="final-override"><summary>Host override</summary><FinalOverrideForm g={g} teamId={teamId} entry={entry} command={command}/></details>;
}
function FinalOverrideForm({g,teamId,entry,command}:{g:GameView;teamId:string;entry?:FinalEntry;command:Command}){
  const[draft,setDraft]=useState<{wager:string;answer:string;wagerVersion:number;answerVersion:number}|null>(null),[busy,setBusy]=useState(false);
  const c=g.current!,team=g.players.find(t=>t.id===teamId)!,max=finalWagerLimit(g.finalPresentation?.scores[teamId]??team.score,g.settings.finalMaxWager);
  const saved={wager:entry?String(entry.wager):'',answer:entry?.answer??'',wagerVersion:entry?.wagerVersion||0,answerVersion:entry?.answerVersion||0};
  const form=draft??saved,conflict=!!draft&&(draft.wagerVersion!==saved.wagerVersion||draft.answerVersion!==saved.answerVersion);
  const change=(key:'wager'|'answer',value:string)=>setDraft(old=>({...old??saved,[key]:value}));
  const invalid=!form.wager.trim()||!Number.isInteger(Number(form.wager))||Number(form.wager)<0||Number(form.wager)>max;
  return <form onSubmit={async e=>{e.preventDefault();if(busy||invalid||conflict)return;setBusy(true);try{if(await command('hostFinalEntry',{questionId:c.questionId,playerId:teamId,wager:Number(form.wager),answer:form.answer,wagerVersion:form.wagerVersion,answerVersion:form.answerVersion}))setDraft(null);}finally{setBusy(false);}}}>
    <label className="field"><span>Wager for {team.name}</span><input type="number" min={0} max={max} value={form.wager} disabled={g.paused||busy} onChange={e=>change('wager',e.target.value)}/></label>
    {c.phase==='final'&&<label className="field"><span>Answer for {team.name}</span><textarea rows={3} maxLength={5000} value={form.answer} disabled={g.paused||busy} onChange={e=>change('answer',e.target.value)}/></label>}
    {conflict&&<p role="alert">This submission changed. <button type="button" onClick={()=>setDraft(null)}>Use saved submission</button></p>}
    <Button type="submit" disabled={g.paused||busy||invalid||conflict}>{busy?'Saving…':'Save submission'}</Button>
  </form>;
}

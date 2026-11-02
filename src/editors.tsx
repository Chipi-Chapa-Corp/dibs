import {useRef,useState} from 'react';
import {Plus,Trash2,Check,ArrowRight,ArrowLeft,Copy,Eye,Code2,Shuffle} from 'lucide-react';
import type {GameView,Question,Round,Settings,Theme} from '../shared/model';
import {emptyQuestion,emptyRound,isQuestionFilled,themes,uid} from '../shared/model';
import {number} from './lib';
import {Button,Checkbox,Field,IconButton,Modal,Radio,RichText,StageContent,Switch,UploadMedia} from './components';
import {useAutosave} from './autosave';
type EditorProps={g:GameView;editorId:string;save:(data:Record<string,unknown>)=>Promise<boolean>};
function AutosaveStatus({autosave}:{autosave:ReturnType<typeof useAutosave>}){return <span className="autosave-status" role="status">{autosave.status==='saving'?'Saving…':autosave.status==='error'?<button onClick={()=>void autosave.retry()}>Couldn’t save · retry</button>:null}</span>}
function EditorHeading({title,autosave,children}:{title:string;autosave:ReturnType<typeof useAutosave>;children?:React.ReactNode}){return <div className="editor-heading"><h1>{title}</h1><div className="toolbar-actions">{children}<AutosaveStatus autosave={autosave}/></div></div>}

export function QuestionsEditor({g,save,editorId}:EditorProps){
  const [rounds,setRounds]=useState<Round[]>(()=>structuredClone(g.rounds));
  const [index,setIndex]=useState(g.roundIndex);
  const [edit,setEdit]=useState<{q:Question;c:string}|null>(null);
  const [pendingRemove,setPendingRemove]=useState<number|null>(null);
  const [newRound,setNewRound]=useState(false),[roundName,setRoundName]=useState(''),[roundType,setRoundType]=useState<'board'|'final'>('board');
  const autosave=useAutosave(save);
  const r=rounds[index];
  const update=(next:Round[],delay=0)=>{setRounds(next);autosave.schedule({rounds:next},delay);};
  const patch=(fn:(r:Round)=>Round,delay=0)=>update(rounds.map((r,i)=>i===index?fn(r):r),delay);
  const rowCount=Math.max(0,...r.categories.map(c=>c.questions.length));
  const rowValue=(row:number)=>r.categories.find(c=>c.questions[row])?.questions[row].value??(row+1)*100;
  const removeRow=(row:number)=>{
    patch(r=>({...r,categories:r.categories.map(c=>({...c,questions:c.questions.filter((_,i)=>i!==row)}))}));
    setPendingRemove(null);
  };
  const requestRemoveRow=(row:number)=>{
    const hasContent=r.categories.some(c=>{
      const q=c.questions[row];
      return q&&(q.prompt.trim()||q.answer.trim()||q.answerOptions?.some(option=>option.trim())||q.notes.trim()||q.modifier?.title.trim()||q.modifier?.instructions.trim());
    });
    if(hasContent)setPendingRemove(row);else removeRow(row);
  };
  const addQuestion=(categoryId:string)=>{
    const value=Math.max(0,...r.categories.map(c=>c.questions.at(-1)?.value||0))+100;
    const categories=r.categories.map(c=>({...c,questions:[...Array.from({length:rowCount},(_,i)=>c.questions[i]||emptyQuestion(rowValue(i))),emptyQuestion(value)]}));
    patch(r=>({...r,categories}));
    setEdit({q:categories.find(c=>c.id===categoryId)!.questions[rowCount],c:categoryId});
  };
  const duplicate=()=>{const n=structuredClone(r);n.id=uid();n.name+=' (copy)';n.categories=n.categories.map(c=>({...c,id:uid(),questions:c.questions.map(q=>({...q,id:uid()}))}));update([...rounds.slice(0,index+1),n,...rounds.slice(index+1)]);setIndex(index+1);};
  const changeQuestion=(q:Question,delay=450)=>patch(r=>({...r,categories:r.categories.map(c=>c.id===edit?.c?{...c,questions:c.questions.map(x=>x.id===q.id?q:x)}:c)}),delay);
  return <>
    <div className="round-tabs">{rounds.map((r,i)=><button key={r.id} onClick={()=>setIndex(i)} className={index===i?'active':''}><span>{String(i+1).padStart(2,'0')}</span>{r.name}{r.type==='final'&&<span className="tag">Final</span>}</button>)}<Button className="add-round" disabled={rounds.length>=20} onClick={()=>{setRoundName(`Round ${rounds.length+1}`);setNewRound(true);}}><Plus size={20}/>Round</Button></div>
    <div className="round-edit-toolbar"><Field label="Round name"><input value={r.name} onChange={e=>patch(r=>({...r,name:e.target.value}),450)} maxLength={60}/></Field><div className="toolbar-actions"><AutosaveStatus autosave={autosave}/><IconButton title="Move round earlier" disabled={index===0} onClick={()=>{const n=[...rounds];[n[index-1],n[index]]=[n[index],n[index-1]];update(n);setIndex(index-1);}}><ArrowLeft/></IconButton><IconButton title="Move round later" disabled={index===rounds.length-1} onClick={()=>{const n=[...rounds];[n[index+1],n[index]]=[n[index],n[index+1]];update(n);setIndex(index+1);}}><ArrowRight/></IconButton><IconButton title="Duplicate round" onClick={duplicate}><Copy/></IconButton><IconButton title="Remove round" disabled={rounds.length===1} onClick={()=>{update(rounds.filter((_,i)=>i!==index));setIndex(Math.max(0,index-1));}}><Trash2/></IconButton></div></div>
    <div className="question-grid-scroll"><div className="question-editor-grid" style={{'--question-grid-rows':rowCount+2}as React.CSSProperties}>{r.categories.map((c,ci)=><div className="question-category" key={c.id}>
      <div className="category-editor-head"><input aria-label={`Category ${ci+1} name`} value={c.name} onChange={e=>patch(r=>({...r,categories:r.categories.map(x=>x.id===c.id?{...x,name:e.target.value}:x)}),450)} maxLength={60}/><div className="category-tools"><IconButton title={`Move ${c.name} left`} disabled={ci===0} onClick={()=>patch(r=>{const n=[...r.categories];[n[ci-1],n[ci]]=[n[ci],n[ci-1]];return{...r,categories:n};})}><ArrowLeft size={18}/></IconButton><IconButton title={`Delete ${c.name}`} onClick={()=>patch(r=>({...r,categories:r.categories.filter(x=>x.id!==c.id)}))}><Trash2 size={18}/></IconButton></div></div>
      {Array.from({length:rowCount},(_,row)=>{const q=c.questions[row];return q?<button key={q.id} className={`question-editor-cell ${isQuestionFilled(q)?'filled':''}`} onClick={()=>setEdit({q:structuredClone(q),c:c.id})}><strong>{r.type==='final'?'Final':number(q.value)}</strong><span>{q.modifier?`Modifier · ${q.modifier.title||'Untitled'}`:q.prompt.trim()?q.prompt.replace(/[#*\[\]!_`]/g,'').slice(0,65):'No question'}</span>{q.dailyDouble&&<span className="dd-label">DD</span>}</button>:<div key={`empty-${row}`} aria-hidden="true"/>;})}
      <Button className="add-question" disabled={rowCount>=(r.type==='final'?1:12)} onClick={()=>addQuestion(c.id)}><Plus size={20}/>Question</Button>
    </div>)}<div className="question-category question-row-actions">
      <div className="category-editor-head">{r.type!=='final'&&r.categories.length<10&&<Button className="add-category" onClick={()=>patch(r=>({...r,categories:[...r.categories,{id:uid(),name:`Category ${r.categories.length+1}`,questions:Array.from({length:rowCount},(_,i)=>emptyQuestion(rowValue(i)))}]}))}><Plus size={20}/>Category</Button>}{r.type==='final'&&r.categories.length===0&&<Button className="add-category" onClick={()=>patch(r=>({...r,categories:[{id:uid(),name:'Final category',questions:[]}]}))}><Plus size={20}/>Category</Button>}</div>
      {Array.from({length:rowCount},(_,row)=><div className="question-row-action" key={row}><Button className="remove-question-row" onClick={()=>requestRemoveRow(row)}><Trash2 size={20}/>Remove {r.type==='final'?'final':number(rowValue(row))}</Button></div>)}
    </div></div></div>
    {pendingRemove!==null&&<Modal title="Remove question row?" onClose={()=>setPendingRemove(null)}><p>Remove the {r.type==='final'?'final':number(rowValue(pendingRemove))} row from every category? Questions, answers, modifiers and host notes in this row will be deleted.</p><div className="modal-actions"><Button onClick={()=>setPendingRemove(null)}>Cancel</Button><Button variant="danger" onClick={()=>removeRow(pendingRemove)}><Trash2 size={20}/>Remove row</Button></div></Modal>}
    {edit&&<QuestionEditor key={edit.q.id} g={g} editorId={editorId} allowModifier={r.type!=='final'} question={edit.q} onClose={()=>setEdit(null)} onChange={changeQuestion} onDelete={q=>{changeQuestion({...emptyQuestion(q.value),id:q.id},0);setEdit(null);}}/>}
    {newRound&&<Modal title="Add round" onClose={()=>setNewRound(false)}><Field label="Name"><input autoFocus value={roundName} onChange={e=>setRoundName(e.target.value)} maxLength={60}/></Field><Field label="Format"><select value={roundType} onChange={e=>setRoundType(e.target.value as 'board'|'final')}><option value="board">Question board</option><option value="final">Final · private wagers & answers</option></select></Field><div className="modal-actions"><span/><Button variant="primary" onClick={()=>{const n=emptyRound(rounds.length+1);n.name=roundName||n.name;n.type=roundType;update([...rounds,n]);setIndex(rounds.length);setNewRound(false);}}><Plus size={20}/>Add round</Button></div></Modal>}
  </>;
}

function QuestionEditor({g,editorId,question,allowModifier,onChange,onDelete,onClose}:{g:GameView;editorId:string;question:Question;allowModifier:boolean;onChange:(q:Question,delay?:number)=>void;onDelete:(q:Question)=>void;onClose:()=>void}){
  const[q,set]=useState<Question>(()=>{
    const answerOptions=question.answerOptions?.length?[...question.answerOptions]:[question.answer];
    while(answerOptions.length<2)answerOptions.push('');
    return{...question,answerOptions,correctAnswerIndex:question.correctAnswerIndex??0,shuffleAnswers:question.shuffleAnswers!==false};
  }),[preview,setPreview]=useState(false),[responsePreview,setResponsePreview]=useState(false);
  const[activeAnswer,setActiveAnswer]=useState(question.correctAnswerIndex??0);
  const[modifierDraft,setModifierDraft]=useState(question.modifier||{title:'',instructions:''});
  const answerInputs=useRef<(HTMLInputElement|null)[]>([]);
  const answers=q.answerOptions?.length?q.answerOptions:[q.answer];
  const correct=Math.min(q.correctAnswerIndex??0,answers.length-1);
  const patch=(data:Partial<Question>,delay=450)=>{const next={...q,...data};set(next);onChange(next,delay);};
  const updateAnswers=(answerOptions:string[],correctAnswerIndex=correct,delay=450)=>patch({answerOptions,correctAnswerIndex,answer:answerOptions[correctAnswerIndex]},delay);
  const addAnswer=()=>{
    setResponsePreview(false);setActiveAnswer(answers.length);
    updateAnswers([...answers,''],correct,0);
    requestAnimationFrame(()=>answerInputs.current[answers.length]?.focus());
  };
  const removeAnswer=(index:number)=>{
    if(answers.length<=2)return;
    const next=answers.filter((_,i)=>i!==index);
    setActiveAnswer(index===activeAnswer?index%next.length:index<activeAnswer?activeAnswer-1:activeAnswer);
    updateAnswers(next,index===correct?index%next.length:index<correct?correct-1:correct,0);
  };
  return <Modal title="Edit question" onClose={onClose} wide>
    <div className="question-settings">
      <Field label="Board value"><input type="number" min={0} step={100} value={q.value} onChange={e=>patch({value:Number(e.target.value)})}/></Field>
      <Checkbox label="Daily double" checked={q.dailyDouble} disabled={!!q.modifier||!allowModifier} onChange={dailyDouble=>patch({dailyDouble},0)}/>
    </div>
    <div className="question-prompt-editor">
      <div className="markdown-tools"><label htmlFor={`question-prompt-${q.id}`}>Question</label><div className="toolbar-actions"><UploadMedia id={g.id} editorId={editorId} onInsert={s=>patch({prompt:q.prompt+s})}/><IconButton title={preview?'Edit Markdown':'Preview Markdown'} onClick={()=>setPreview(!preview)}>{preview?<Code2/>:<Eye/>}</IconButton></div></div>
      {preview?<div className="markdown-preview"><RichText text={q.prompt||'*Nothing here yet.*'}/></div>:<textarea id={`question-prompt-${q.id}`} className="markdown-editor" value={q.prompt} onChange={e=>patch({prompt:e.target.value})} placeholder="Write your question. Markdown, images and media links work here." rows={5}/>}
    </div>
    <section className="question-answer-editor" aria-label="Answer or modifier">
      <div className="question-answer-toolbar">
        {allowModifier?<div className="segmented" role="group" aria-label="Question type"><button type="button" aria-pressed={!q.modifier} className={!q.modifier?'selected':''} onClick={()=>{setResponsePreview(false);patch({modifier:null},0);}}>Answer</button><button type="button" aria-pressed={!!q.modifier} className={q.modifier?'selected':''} onClick={()=>{setResponsePreview(false);patch({modifier:modifierDraft,dailyDouble:false},0);}}>Modifier</button></div>:<h3>Answer</h3>}
        <div className="toolbar-actions">
          {!q.modifier&&<IconButton title="Shuffle answers" aria-pressed={q.shuffleAnswers!==false} onClick={()=>patch({shuffleAnswers:q.shuffleAnswers===false},0)}><Shuffle size={20}/></IconButton>}
          <UploadMedia id={g.id} editorId={editorId} onInsert={s=>{
            if(q.modifier){const modifier={...q.modifier,instructions:q.modifier.instructions+s};setModifierDraft(modifier);patch({modifier});}
            else updateAnswers(answers.map((answer,i)=>i===activeAnswer?`${answer}${answer?' ':''}${s.trim()}`:answer));
          }}/>
          <IconButton title={`${responsePreview?'Edit':'Preview'} ${q.modifier?'modifier':'answers'}`} aria-pressed={responsePreview} onClick={()=>setResponsePreview(!responsePreview)}>{responsePreview?<Code2 size={20}/>:<Eye size={20}/>}</IconButton>
        </div>
      </div>
      {q.modifier?responsePreview?<div className="modifier-preview markdown-preview"><h3>{q.modifier.title}</h3><RichText text={q.modifier.instructions||'*Nothing here yet.*'}/></div>:<div className="modifier-fields">
        <Field label="Modifier title"><input value={q.modifier.title} maxLength={80} placeholder="Trading places" onChange={e=>{const modifier={...q.modifier!,title:e.target.value};setModifierDraft(modifier);patch({modifier});}}/></Field>
        <Field label="What it does" hint="The presenter applies this manually. Include any duration here."><textarea rows={3} value={q.modifier.instructions} maxLength={20000} placeholder="Swap your points with another team. Include any duration here." onChange={e=>{const modifier={...q.modifier!,instructions:e.target.value};setModifierDraft(modifier);patch({modifier});}}/></Field>
      </div>:<fieldset className="answer-options-editor"><legend className="visually-hidden">Answers</legend>
        {answers.map((answer,i)=><div className={`answer-option-row has-choices ${activeAnswer===i?'is-active':''}`} key={i}>
          <Radio name={`correct-answer-${q.id}`} label={`Answer ${i+1} is correct`} checked={correct===i} onChange={()=>{setActiveAnswer(i);updateAnswers(answers,i,0);}}/>
          {responsePreview?<div className="answer-option-preview" tabIndex={0} aria-label={`Answer ${i+1} preview`} onFocus={()=>setActiveAnswer(i)} onClick={()=>setActiveAnswer(i)}><RichText text={answer||'*No answer yet.*'}/></div>:<input ref={node=>{answerInputs.current[i]=node;}} aria-label={`Answer ${i+1}`} value={answer} onFocus={()=>setActiveAnswer(i)} onChange={e=>updateAnswers(answers.map((value,index)=>index===i?e.target.value:value))} placeholder={`Answer ${i+1}`} maxLength={100000}/>}
          <IconButton title={`Remove answer ${i+1}`} disabled={answers.length<=2} onClick={()=>removeAnswer(i)}><Trash2 size={20}/></IconButton>
        </div>)}
        <Button className="add-answer" onClick={addAnswer}><Plus size={20}/>Add answer</Button>
      </fieldset>}
    </section>
    <div className="question-host-notes"><Field label="Host notes"><textarea rows={3} value={q.notes} onChange={e=>patch({notes:e.target.value})}/></Field></div>
    <div className="modal-actions"><Button variant="danger" onClick={()=>onDelete(q)}><Trash2 size={20}/>Clear question</Button><Button variant="primary" onClick={onClose}><Check size={20}/>Done</Button></div>
  </Modal>;
}

export function AppearanceEditor({g,save,editorId}:EditorProps){const[theme,set]=useState<Theme>(structuredClone(g.theme));const autosave=useAutosave(save);const patch=(d:Partial<Theme>,delay=0)=>{const next={...theme,...d};set(next);autosave.schedule({theme:next},delay);};return <><EditorHeading title="Appearance" autosave={autosave}/><div className="appearance-layout"><section><div className="field"><span>Theme</span><div className="theme-picks">{(Object.keys(themes)as Theme['preset'][]).map(k=><button className={`theme-pick ${theme.preset===k?'selected':''}`} style={{background:themes[k].paper,color:themes[k].ink}} key={k} onClick={()=>patch({preset:k,...themes[k]})}><span style={{color:themes[k].accent}}>Aa</span>{k[0].toUpperCase()+k.slice(1)}{theme.preset===k&&<Check size={18}/>}</button>)}</div></div><Field label="Presenter title"><input value={theme.title} placeholder={g.name} onChange={e=>patch({title:e.target.value},450)} maxLength={70}/></Field><Field label="Display type"><select value={theme.displayFont} onChange={e=>patch({displayFont:e.target.value as 'serif'|'sans'})}><option value="serif">Serif · editorial</option><option value="sans">Sans · modern</option></select></Field><div className="color-fields">{(['accent','paper','ink','surface','muted','line']as const).map(key=><label key={key}><input aria-label={`${key} color`} type="color" value={theme[key]} onChange={e=>patch({[key]:e.target.value})}/><span>{key[0].toUpperCase()+key.slice(1)}</span><code>{theme[key]}</code></label>)}</div><Field label="Background image URL"><input value={theme.background} onChange={e=>patch({background:e.target.value},450)} placeholder="https://… or /media/…"/></Field><UploadMedia id={g.id} editorId={editorId} onInsert={s=>{const match=s.match(/\]\(([^)]+)\)/);if(match)patch({background:match[1]});}}/><div className="appearance-toggles"><Switch label="Presenter animations" checked={theme.motion} onChange={motion=>patch({motion})}/><Switch label="Sound cues" checked={theme.sound} onChange={sound=>patch({sound})}/></div></section><div className="appearance-preview"><span className="eyebrow">Presenter preview</span><div><StageContent g={{...g,theme}} preview/></div></div></div></>}

export function SettingsEditor({g,save}:EditorProps){const[s,set]=useState<Settings>(structuredClone(g.settings)),[name,setName]=useState(g.name),[subtitle]=useState(g.subtitle);const autosave=useAutosave(save);const patch=(d:Partial<Settings>,delay=0)=>{const next={...s,...d};set(next);autosave.schedule({settings:next,name,subtitle},delay);};const toggle=(key:keyof Settings,label:string)=><Switch label={label} checked={!!s[key]} onChange={v=>patch({[key]:v})}/>;const num=(key:keyof Settings,label:string,min=0,max=3600,step=1)=><Field label={label}><input type="number" min={min} max={max} step={step} value={Number(s[key])} onChange={e=>patch({[key]:Number(e.target.value)},450)}/></Field>;return <><EditorHeading title="Settings" autosave={autosave}/><div className="settings-form"><section className="settings-section"><h2>The basics</h2><div className="form-grid"><Field label="Game name"><input value={name} onChange={e=>{setName(e.target.value);autosave.schedule({settings:s,name:e.target.value,subtitle});}} maxLength={80}/></Field>{num('startingScore','Starting score',-1e7,1e7)}</div>{toggle('requireReady','Everyone must be ready before starting')}</section><section className="settings-section"><h2>Buzzers</h2><div className="form-grid"><Field label="Answer order"><select value={s.buzzMode} onChange={e=>patch({buzzMode:e.target.value as Settings['buzzMode']})}><option value="first">First buzz locks everyone else</option><option value="queue">Keep a queue of all buzzes</option></select></Field>{num('earlyPenaltyMs','Early buzz lockout, ms',0,10000,50)}</div>{toggle('autoOpenBuzzers','Open buzzers with every question')}{toggle('lockWrong','Lock a player out after an incorrect answer')}{toggle('reopenWrong','Reopen buzzers after an incorrect answer')}</section><section className="settings-section"><h2>Scoring</h2><div className="form-grid">{num('correctMultiplier','Correct answer multiplier',0,100,.1)}{num('wrongMultiplier','Incorrect answer multiplier',0,100,.1)}</div>{toggle('deductWrong','Deduct points for incorrect answers')}{toggle('allowNegative','Allow negative scores')}</section><section className="settings-section"><h2>Answer reveals</h2>{num('revealDelayMs','Answer reveal delay, ms',0,10000,100)}</section><section className="settings-section"><h2>Final round</h2><Field label="Maximum wager"><select value={s.finalMaxWager} onChange={e=>patch({finalMaxWager:e.target.value as Settings['finalMaxWager']})}><option value="score">Current score (zero if negative)</option><option value="unlimited">Unlimited</option></select></Field></section><section className="settings-section"><h2>Screens</h2>{toggle('showQuestionOnPhone','Show questions on players’ phones')}{toggle('showScoresOnPhone','Show scores and standings on phones')}{toggle('showLeaderboardOnStage','Show scores on the presenter screen')}</section></div></>}

import {useRef,useState} from 'react';
import {Plus,Trash2,Check,ArrowRight,ArrowLeft,Copy,Eye,Code2,Shuffle} from 'lucide-react';
import type {GameView,Question,Round,Settings,Theme} from '../shared/model';
import {emptyQuestion,emptyRound,isQuestionFilled,nextBoardValue,orderRounds,numberRounds,roundName,themes,uid} from '../shared/model';
import {number} from './lib';
import {Button,Checkbox,Field,IconButton,Modal,Radio,RichText,StageContent,Switch,UploadMedia} from './components';
import {useAutosave} from './autosave';
type EditorProps={g:GameView;editorId:string;save:(data:Record<string,unknown>)=>Promise<boolean>};
const hasQuestionContent=(q:Question)=>!!(q.prompt.trim()||q.answer.trim()||q.answerOptions?.some(option=>option.trim())||q.notes.trim()||q.modifier?.title.trim()||q.modifier?.instructions.trim());
function AutosaveStatus({autosave}:{autosave:ReturnType<typeof useAutosave>}){return <span className="autosave-status" role="status">{autosave.status==='saving'?'Saving…':autosave.status==='error'?<button onClick={()=>void autosave.retry()}>Couldn’t save · retry</button>:null}</span>}
function EditorHeading({title,autosave,children}:{title:string;autosave:ReturnType<typeof useAutosave>;children?:React.ReactNode}){return <div className="editor-heading"><h1>{title}</h1><div className="toolbar-actions">{children}<AutosaveStatus autosave={autosave}/></div></div>}

export function QuestionsEditor({g,save,editorId}:EditorProps){
  const [rounds,setRounds]=useState<Round[]>(()=>numberRounds(orderRounds(structuredClone(g.rounds))));
  const [index,setIndex]=useState(g.roundIndex);
  const [edit,setEdit]=useState<{q:Question;c:string}|null>(null);
  const [pendingRemove,setPendingRemove]=useState<{q:Question;c:string}|null>(null);
  const [pendingRoundRemove,setPendingRoundRemove]=useState<Round|null>(null);
  const [finalDraft]=useState(()=>emptyQuestion(0));
  const [finalVersion,setFinalVersion]=useState(0);
  const [newRound,setNewRound]=useState(false),[roundType,setRoundType]=useState<'board'|'final'>('board');
  const autosave=useAutosave(save);
  const r=rounds[index];
  const finalQuestion=r.categories.flatMap(c=>c.questions)[0]||finalDraft;
  const hasFinal=rounds.some(r=>r.type==='final');
  const update=(next:Round[],delay=0)=>{const numbered=numberRounds(orderRounds(next));setRounds(numbered);autosave.schedule({rounds:numbered},delay);};
  const patch=(fn:(r:Round)=>Round,delay=0)=>update(rounds.map((r,i)=>i===index?fn(r):r),delay);
  const removeQuestion=({q,c}:{q:Question;c:string})=>{
    patch(r=>({...r,categories:r.categories.map(category=>category.id===c?{...category,questions:category.questions.filter(x=>x.id!==q.id)}:category)}));
    setEdit(null);
    setPendingRemove(null);
  };
  const requestRemoveQuestion=(q:Question)=>{
    const target={q,c:edit!.c};
    setEdit(target);
    if(hasQuestionContent(q))setPendingRemove(target);else removeQuestion(target);
  };
  const removeRound=(round:Round)=>{
    if(rounds.length<=1)return;
    const removedIndex=rounds.findIndex(r=>r.id===round.id);
    if(removedIndex<0)return;
    update(rounds.filter(r=>r.id!==round.id));setIndex(Math.max(0,removedIndex-1));setPendingRoundRemove(null);
  };
  const requestRemoveRound=()=>{
    if(r.categories.some(c=>c.questions.some(hasQuestionContent)))setPendingRoundRemove(r);
    else removeRound(r);
  };
  const addQuestion=(categoryId:string)=>{
    const category=r.categories.find(c=>c.id===categoryId)!;
    const q=emptyQuestion(r.type==='final'?0:nextBoardValue(category.questions,index));
    const categories=r.categories.map(c=>c.id===categoryId?{...c,questions:[...c.questions,q]}:c);
    patch(r=>({...r,categories}));
    setEdit({q,c:categoryId});
  };
  const changeFinal=(q:Question,delay=450)=>patch(r=>{
    const category=r.categories.find(c=>c.questions.some(question=>question.id===q.id))||r.categories[0];
    return{...r,categories:category?r.categories.map(c=>c.id===category.id?{...c,questions:c.questions.length?c.questions.map(question=>question.id===q.id?q:question):[q]}:c):[{id:uid(),name:'Final',questions:[q]}]};
  },delay);
  const duplicate=()=>{const n=structuredClone(r);n.id=uid();n.categories=n.categories.map(c=>({...c,id:uid(),questions:c.questions.map(q=>({...q,id:uid()}))}));const next=orderRounds([...rounds.slice(0,index+1),n,...rounds.slice(index+1)]);update(next);setIndex(next.findIndex(round=>round.id===n.id));};
  const changeQuestion=(q:Question,delay=450)=>patch(r=>({...r,categories:r.categories.map(c=>c.id===edit?.c?{...c,questions:c.questions.map(x=>x.id===q.id?q:x)}:c)}),delay);
  return <>
    <div className="round-tabs">{rounds.map((round,i)=><button key={round.id} onClick={()=>setIndex(i)} className={index===i?'active':''}>{roundName(i)}{round.type==='final'&&<span className="tag">Final</span>}</button>)}<Button className="add-round" disabled={rounds.length>=20} onClick={()=>{setRoundType('board');setNewRound(true);}}><Plus size={20}/>Round</Button>{!hasFinal&&<Button className="add-round" disabled={rounds.length>=20} onClick={()=>{setRoundType('final');setNewRound(true);}}><Plus size={20}/>Final</Button>}</div>
    <div className="round-edit-toolbar"><h2>{roundName(index)}</h2><div className="toolbar-actions"><AutosaveStatus autosave={autosave}/><IconButton title="Move round earlier" disabled={r.type==='final'||index===0} onClick={()=>{const n=[...rounds];[n[index-1],n[index]]=[n[index],n[index-1]];update(orderRounds(n));setIndex(index-1);}}><ArrowLeft/></IconButton><IconButton title="Move round later" disabled={r.type==='final'||index===rounds.length-1||rounds[index+1]?.type==='final'} onClick={()=>{const n=[...rounds];[n[index+1],n[index]]=[n[index],n[index+1]];update(orderRounds(n));setIndex(index+1);}}><ArrowRight/></IconButton><IconButton title="Duplicate round" disabled={r.type==='final'||rounds.length>=20} onClick={duplicate}><Copy/></IconButton><IconButton title="Remove round" disabled={rounds.length===1} onClick={requestRemoveRound}><Trash2/></IconButton></div></div>
    {r.type==='final'?<section className="final-question-editor" aria-label="Final question"><QuestionFields key={`${r.id}:${finalQuestion.id}:${finalVersion}`} g={g} editorId={editorId} allowModifier={false} showSettings={false} question={finalQuestion} onChange={changeFinal} onDelete={q=>{changeFinal({...emptyQuestion(0),id:q.id},0);setFinalVersion(version=>version+1);}}/></section>:<div className="question-grid-scroll"><div className="question-editor-grid">{r.categories.map((c,ci)=><div className="question-category" key={c.id}>
      <div className="category-editor-head"><input aria-label={`Category ${ci+1} name`} value={c.name} onChange={e=>patch(round=>({...round,categories:round.categories.map(x=>x.id===c.id?{...x,name:e.target.value}:x)}),450)} maxLength={60}/><div className="category-tools"><IconButton title={`Move ${c.name} left`} disabled={ci===0} onClick={()=>patch(round=>{const n=[...round.categories];[n[ci-1],n[ci]]=[n[ci],n[ci-1]];return{...round,categories:n};})}><ArrowLeft size={18}/></IconButton><IconButton title={`Delete ${c.name}`} onClick={()=>patch(round=>({...round,categories:round.categories.filter(x=>x.id!==c.id)}))}><Trash2 size={18}/></IconButton></div></div>
      {c.questions.map(q=><button key={q.id} aria-label={`${c.name}, ${q.value}`} className={`question-editor-cell ${isQuestionFilled(q)?'filled':''}`} onClick={()=>setEdit({q:structuredClone(q),c:c.id})}><strong>{number(q.value)}</strong><span>{q.modifier?`Modifier · ${q.modifier.title||'Untitled'}`:q.prompt.trim()?q.prompt.replace(/[#*\[\]!_`]/g,'').slice(0,65):'No question'}</span>{q.dailyDouble&&<span className="dd-label">DD</span>}</button>)}
      <Button className="add-question" aria-label={`Add question to ${c.name}`} disabled={c.questions.length>=12} onClick={()=>addQuestion(c.id)}><Plus size={20}/>Question</Button>
    </div>)}<div className="question-category"><div className="category-editor-head">{r.categories.length<10&&<Button className="add-category" onClick={()=>patch(round=>({...round,categories:[...round.categories,{id:uid(),name:`Category ${round.categories.length+1}`,questions:[]}]}))}><Plus size={20}/>Category</Button>}</div></div></div></div>}
    {pendingRoundRemove&&<Modal title={pendingRoundRemove.type==='final'?'Remove Final?':'Remove round?'} onClose={()=>setPendingRoundRemove(null)}><p>Remove <strong>{pendingRoundRemove.name}</strong> and all its question data? This cannot be undone.</p><div className="modal-actions"><Button onClick={()=>setPendingRoundRemove(null)}>Cancel</Button><Button variant="danger" onClick={()=>removeRound(pendingRoundRemove)}><Trash2 size={20}/>{pendingRoundRemove.type==='final'?'Remove Final':'Remove round'}</Button></div></Modal>}
    {edit&&!pendingRemove&&<QuestionEditor key={edit.q.id} g={g} editorId={editorId} allowModifier={r.type!=='final'} question={edit.q} onClose={()=>setEdit(null)} onChange={changeQuestion} onDelete={requestRemoveQuestion}/>}
    {pendingRemove&&<Modal title="Delete question?" onClose={()=>setPendingRemove(null)}><p>Delete the {number(pendingRemove.q.value)} question from {r.categories.find(c=>c.id===pendingRemove.c)?.name}? Its answers, modifier and host notes will also be deleted.</p><div className="modal-actions"><Button onClick={()=>setPendingRemove(null)}>Cancel</Button><Button variant="danger" onClick={()=>removeQuestion(pendingRemove)}><Trash2 size={20}/>Delete question</Button></div></Modal>}
    {newRound&&<Modal title="Add round" onClose={()=>setNewRound(false)}><Field label="Format"><select autoFocus value={roundType} onChange={e=>setRoundType(e.target.value as 'board'|'final')}><option value="board">Question board</option><option value="final" disabled={hasFinal}>Final · private wagers & answers</option></select></Field><div className="modal-actions"><span/><Button variant="primary" disabled={roundType==='final'&&hasFinal} onClick={()=>{const next=emptyRound(rounds.filter(round=>round.type==='board').length+1);next.type=roundType;if(roundType==='final')next.categories=[{id:uid(),name:'Final',questions:[emptyQuestion(0)]}];const nextRounds=orderRounds([...rounds,next]);update(nextRounds);setIndex(nextRounds.findIndex(round=>round.id===next.id));setNewRound(false);}}><Plus size={20}/>Add round</Button></div></Modal>}
  </>;
}

type QuestionFieldsProps={g:GameView;editorId:string;question:Question;allowModifier:boolean;showSettings?:boolean;onChange:(q:Question,delay?:number)=>void;onDelete:(q:Question)=>void;onClose?:()=>void};
function QuestionEditor(props:QuestionFieldsProps&{onClose:()=>void}){return <Modal title="Edit question" onClose={props.onClose} wide><QuestionFields {...props}/></Modal>}
function QuestionFields({g,editorId,question,allowModifier,showSettings=true,onChange,onDelete,onClose}:QuestionFieldsProps){
  const[q,set]=useState<Question>(()=>{
    const answerOptions=question.answerOptions?.length?[...question.answerOptions]:[question.answer];
    while(answerOptions.length<2)answerOptions.push('');
    return{...question,answerOptions,correctAnswerIndex:question.correctAnswerIndex??0,shuffleAnswers:question.shuffleAnswers!==false,responseType:question.responseType==='free'?'free':'answer'};
  }),[preview,setPreview]=useState(false),[responsePreview,setResponsePreview]=useState(false);
  const[activeAnswer,setActiveAnswer]=useState(question.correctAnswerIndex??0);
  const[freeDraft,setFreeDraft]=useState(question.answer);
  const[hasFreeDraft,setHasFreeDraft]=useState(question.responseType==='free');
  const[modifierDraft,setModifierDraft]=useState(question.modifier||{title:'',instructions:''});
  const answerInputs=useRef<(HTMLInputElement|null)[]>([]);
  const answers=q.answerOptions?.length?q.answerOptions:[q.answer];
  const correct=Math.min(q.correctAnswerIndex??0,answers.length-1);
  const mode=q.modifier?'modifier':q.responseType==='free'?'free':'answer';
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
  return <div className="question-fields">
    {showSettings&&<div className="question-settings">
      <Field label="Board value"><input type="number" min={0} step={100} value={q.value} onChange={e=>patch({value:Number(e.target.value)})}/></Field>
      <Checkbox label="Daily double" checked={q.dailyDouble} disabled={!!q.modifier||!allowModifier} onChange={dailyDouble=>patch({dailyDouble},0)}/>
    </div>}
    <div className="question-prompt-editor">
      <div className="markdown-tools"><label htmlFor={`question-prompt-${q.id}`}>Question</label><div className="toolbar-actions"><UploadMedia id={g.id} editorId={editorId} onInsert={s=>patch({prompt:q.prompt+s})}/><IconButton title={preview?'Edit Markdown':'Preview Markdown'} onClick={()=>setPreview(!preview)}>{preview?<Code2/>:<Eye/>}</IconButton></div></div>
      {preview?<div className="markdown-preview"><RichText text={q.prompt||'*Nothing here yet.*'}/></div>:<textarea id={`question-prompt-${q.id}`} className="markdown-editor" value={q.prompt} onChange={e=>patch({prompt:e.target.value})} placeholder="Write your question. Markdown, images and media links work here." rows={5}/>}
    </div>
    <section className="question-answer-editor" aria-label="Response">
      <div className="question-answer-toolbar">
        <div className="segmented" role="group" aria-label="Question type"><button type="button" aria-pressed={mode==='answer'} className={mode==='answer'?'selected':''} onClick={()=>{setResponsePreview(false);patch({responseType:'answer',modifier:null,answer:answers[correct],answerOptions:answers,correctAnswerIndex:correct},0);}}>Answer</button>{allowModifier&&<button type="button" aria-pressed={mode==='modifier'} className={mode==='modifier'?'selected':''} onClick={()=>{setResponsePreview(false);patch({responseType:'answer',modifier:modifierDraft,dailyDouble:false},0);}}>Modifier</button>}<button type="button" aria-pressed={mode==='free'} className={mode==='free'?'selected':''} onClick={()=>{setResponsePreview(false);const answer=hasFreeDraft?freeDraft:q.answer;setFreeDraft(answer);setHasFreeDraft(true);patch({responseType:'free',modifier:null,answer},0);}}>Free Response</button></div>
        <div className="toolbar-actions">
          {mode==='answer'&&<IconButton title="Shuffle answers" aria-pressed={q.shuffleAnswers!==false} onClick={()=>patch({shuffleAnswers:q.shuffleAnswers===false},0)}><Shuffle size={20}/></IconButton>}
          <UploadMedia id={g.id} editorId={editorId} onInsert={s=>{
            if(q.modifier){const modifier={...q.modifier,instructions:q.modifier.instructions+s};setModifierDraft(modifier);patch({modifier});}
            else if(mode==='free'){setFreeDraft(q.answer+s);patch({answer:q.answer+s});}
            else updateAnswers(answers.map((answer,i)=>i===activeAnswer?`${answer}${answer?' ':''}${s.trim()}`:answer));
          }}/>
          <IconButton title={`${responsePreview?'Edit':'Preview'} ${mode==='modifier'?'modifier':mode==='free'?'free response':'answers'}`} aria-pressed={responsePreview} onClick={()=>setResponsePreview(!responsePreview)}>{responsePreview?<Code2 size={20}/>:<Eye size={20}/>}</IconButton>
        </div>
      </div>
      {q.modifier?responsePreview?<div className="modifier-preview markdown-preview"><h3>{q.modifier.title}</h3><RichText text={q.modifier.instructions||'*Nothing here yet.*'}/></div>:<div className="modifier-fields">
        <Field label="Modifier title"><input value={q.modifier.title} maxLength={80} placeholder="Trading places" onChange={e=>{const modifier={...q.modifier!,title:e.target.value};setModifierDraft(modifier);patch({modifier});}}/></Field>
        <Field label="What it does" hint="The presenter applies this manually. Include any duration here."><textarea rows={3} value={q.modifier.instructions} maxLength={20000} placeholder="Swap your points with another team. Include any duration here." onChange={e=>{const modifier={...q.modifier!,instructions:e.target.value};setModifierDraft(modifier);patch({modifier});}}/></Field>
      </div>:mode==='free'?<div className="free-response-editor">{responsePreview?<div className="markdown-preview" aria-label="Expected answer preview"><RichText text={q.answer||'*Nothing here yet.*'}/></div>:<Field label="Expected answer"><textarea rows={3} value={q.answer} maxLength={100000} onChange={e=>{setFreeDraft(e.target.value);patch({answer:e.target.value});}}/></Field>}</div>:<fieldset className="answer-options-editor"><legend className="visually-hidden">Answers</legend>
        {answers.map((answer,i)=><div className={`answer-option-row has-choices ${activeAnswer===i?'is-active':''}`} key={i}>
          <Radio name={`correct-answer-${q.id}`} label={`Answer ${i+1} is correct`} checked={correct===i} onChange={()=>{setActiveAnswer(i);updateAnswers(answers,i,0);}}/>
          {responsePreview?<div className="answer-option-preview" tabIndex={0} aria-label={`Answer ${i+1} preview`} onFocus={()=>setActiveAnswer(i)} onClick={()=>setActiveAnswer(i)}><RichText text={answer||'*No answer yet.*'}/></div>:<input ref={node=>{answerInputs.current[i]=node;}} aria-label={`Answer ${i+1}`} value={answer} onFocus={()=>setActiveAnswer(i)} onChange={e=>updateAnswers(answers.map((value,index)=>index===i?e.target.value:value))} placeholder={`Answer ${i+1}`} maxLength={100000}/>}
          <IconButton title={`Remove answer ${i+1}`} disabled={answers.length<=2} onClick={()=>removeAnswer(i)}><Trash2 size={20}/></IconButton>
        </div>)}
        <Button className="add-answer" onClick={addAnswer}><Plus size={20}/>Add answer</Button>
      </fieldset>}
    </section>
    <div className="question-host-notes"><Field label="Host notes"><textarea rows={3} value={q.notes} onChange={e=>patch({notes:e.target.value})}/></Field></div>
    <div className="modal-actions"><Button variant="danger" onClick={()=>onDelete(q)}><Trash2 size={20}/>{onClose?'Delete question':'Clear question'}</Button>{onClose&&<Button variant="primary" onClick={onClose}><Check size={20}/>Done</Button>}</div>
  </div>;
}

export function AppearanceEditor({g,save,editorId}:EditorProps){const[theme,set]=useState<Theme>(structuredClone(g.theme));const autosave=useAutosave(save);const patch=(d:Partial<Theme>,delay=0)=>{const next={...theme,...d};set(next);autosave.schedule({theme:next},delay);};return <><EditorHeading title="Appearance" autosave={autosave}/><div className="appearance-layout"><section><div className="field"><span>Theme</span><div className="theme-picks">{(Object.keys(themes)as Theme['preset'][]).map(k=><button className={`theme-pick ${theme.preset===k?'selected':''}`} style={{background:themes[k].paper,color:themes[k].ink}} key={k} onClick={()=>patch({preset:k,...themes[k]})}><span style={{color:themes[k].accent}}>Aa</span>{k[0].toUpperCase()+k.slice(1)}{theme.preset===k&&<Check size={18}/>}</button>)}</div></div><Field label="Presenter title"><input value={theme.title} placeholder={g.name} onChange={e=>patch({title:e.target.value},450)} maxLength={70}/></Field><Field label="Display type"><select value={theme.displayFont} onChange={e=>patch({displayFont:e.target.value as 'serif'|'sans'})}><option value="serif">Serif · editorial</option><option value="sans">Sans · modern</option></select></Field><div className="color-fields">{(['accent','paper','ink','surface','muted','line']as const).map(key=><label key={key}><input aria-label={`${key} color`} type="color" value={theme[key]} onChange={e=>patch({[key]:e.target.value})}/><span>{key[0].toUpperCase()+key.slice(1)}</span><code>{theme[key]}</code></label>)}</div><Field label="Background image URL"><input value={theme.background} onChange={e=>patch({background:e.target.value},450)} placeholder="https://… or /media/…"/></Field><UploadMedia id={g.id} editorId={editorId} onInsert={s=>{const match=s.match(/\]\(([^)]+)\)/);if(match)patch({background:match[1]});}}/><div className="appearance-toggles"><Switch label="Presenter animations" checked={theme.motion} onChange={motion=>patch({motion})}/><Switch label="Announcement sounds" description="Question selection has its own sound toggle on the host and presenter screens." checked={theme.sound} onChange={sound=>patch({sound})}/></div></section><div className="appearance-preview"><span className="eyebrow">Presenter preview</span><div><StageContent g={{...g,theme}} preview/></div></div></div></>}

export function SettingsEditor({g,save}:EditorProps){const[s,set]=useState<Settings>(structuredClone(g.settings)),[name,setName]=useState(g.name),[subtitle]=useState(g.subtitle);const autosave=useAutosave(save);const patch=(d:Partial<Settings>,delay=0)=>{const next={...s,...d};set(next);autosave.schedule({settings:next,name,subtitle},delay);};const toggle=(key:keyof Settings,label:string)=><Switch label={label} checked={!!s[key]} onChange={v=>patch({[key]:v})}/>;const num=(key:keyof Settings,label:string,min=0,max=3600,step=1)=><Field label={label}><input type="number" min={min} max={max} step={step} value={Number(s[key])} onChange={e=>patch({[key]:Number(e.target.value)},450)}/></Field>;return <><EditorHeading title="Settings" autosave={autosave}/><div className="settings-form"><section className="settings-section"><h2>The basics</h2><div className="form-grid"><Field label="Game name"><input value={name} onChange={e=>{setName(e.target.value);autosave.schedule({settings:s,name:e.target.value,subtitle});}} maxLength={80}/></Field>{num('startingScore','Starting score',-1e7,1e7)}</div></section><section className="settings-section"><h2>Buzzers</h2><p>Buzzers open with each question. The first team to buzz answers; after an incorrect answer, the remaining teams can buzz again.</p><div className="form-grid">{num('earlyPenaltyMs','Early buzz lockout, ms',0,10000,50)}</div></section><section className="settings-section"><h2>Scoring</h2><div className="form-grid">{num('correctMultiplier','Correct answer multiplier',0,100,.1)}{num('wrongMultiplier','Incorrect answer multiplier',0,100,.1)}</div>{toggle('deductWrong','Deduct points for incorrect answers')}{toggle('allowNegative','Allow negative scores')}</section><section className="settings-section"><h2>Answer reveals</h2>{num('revealDelayMs','Answer reveal delay, ms',0,10000,100)}</section><section className="settings-section"><h2>Final round</h2><Field label="Maximum wager"><select value={s.finalMaxWager} onChange={e=>patch({finalMaxWager:e.target.value as Settings['finalMaxWager']})}><option value="score">Current score (zero if negative)</option><option value="unlimited">Unlimited</option></select></Field></section><section className="settings-section"><h2>Screens</h2>{toggle('showLeaderboardOnStage','Show scores on the presenter screen')}</section></div></>}

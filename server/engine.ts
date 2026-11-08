import {randomBytes} from 'node:crypto';
import {defaultSettings,defaultTheme,emptyRound,uid,themes,isQuestionFilled,QUESTION_SELECTION_MS,orderRounds,numberRounds,hasCorrectResult,finalWagerLimit} from '../shared/model.ts';
import type {Game,GameView,Player,Question,Settings,Theme,Round,TeamMember} from '../shared/model.ts';

type Input=Record<string,any>;
export const token=()=>randomBytes(24).toString('hex');
const clone=<T>(v:T):T=>structuredClone(v);
const finite=(v:unknown,fallback=0,min=-1e9,max=1e9)=>Number.isFinite(Number(v))?Math.min(max,Math.max(min,Number(v))):fallback;
const text=(v:unknown,max=120)=>typeof v==='string'?v.slice(0,max):'';
const assert=(v:unknown,message:string)=>{if(!v)throw new Error(message)};
export const currentQuestion=(g:Game)=>g.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions)).find(q=>q.id===g.current?.questionId)||null;
const scores=(g:Game)=>Object.fromEntries(g.players.map(p=>[p.id,p.score]));
const colors=['#bd4b31','#587058','#636f9a','#9e7639','#8a6080','#427e85','#8b6653','#4d5865'];
export function createGame(input:Input={}):Game {
  const g:Game={id:randomBytes(3).toString('hex').toUpperCase(),name:text(input.name)||'Untitled game',subtitle:'',createdAt:Date.now(),status:'lobby',paused:false,roundIndex:0,rounds:[emptyRound()],modifierClaims:[],settings:clone(defaultSettings),theme:clone(defaultTheme),teamsLocked:false,members:[],players:[],played:[],current:null,history:[],undo:[],questionCount:0,selection:null,announcement:null,revision:0};
  if(input.definition)updateDefinition(g,input.definition);
  return g;
}
export function addPlayer(g:Game,name:string):Player {
  assert(g.status==='lobby'&&!g.teamsLocked,'Teams are fixed after the game starts');
  name=text(name.trim(),32);assert(name,'Enter a team name');
  // A name identifies one team; every buzzer in it shares gameplay and reconnects.
  const existing=g.players.find(p=>p.name.toLowerCase()===name.toLowerCase());if(existing)return existing;
  const p:Player={id:uid(),token:token(),name,color:colors[g.players.length%colors.length],score:g.settings.startingScore,connected:false,ready:false,blockedUntil:0,stats:{correct:0,incorrect:0,buzzes:0},joinedAt:Date.now()};g.players.push(p);g.revision++;return p;
}
export function joinMember(g:Game,input:Input):TeamMember {
  const existing=input.token?g.members.find(m=>m.token===input.token):undefined;
  if(existing)return existing;
  assert(g.status!=='finished','This game has ended');
  assert(g.players.some(t=>t.id===input.teamId),'Choose a team created by the host');
  const name=text(input.name,32).trim();assert(name,'Enter your name');
  const nameKey=name.normalize('NFKC').toLowerCase();
  assert(!g.members.some(m=>m.name.trim().normalize('NFKC').toLowerCase()===nameKey),'A player with this name has already joined. Choose a different name.');
  assert(g.members.length<500,'This game has too many players');
  const member:TeamMember={id:uid(),teamId:input.teamId,name,token:token(),connected:false,joinedAt:Date.now()};
  g.members.push(member);g.revision++;return member;
}
export function removeMember(g:Game,memberId:string){
  assert(g.members.some(m=>m.id===memberId),'Player not found');
  g.members=g.members.filter(m=>m.id!==memberId);
  for(const team of g.players)team.connected=g.members.some(m=>m.teamId===team.id&&m.connected);
  g.revision++;
}
export function normalizeSettings(data:Input,old=defaultSettings):Settings {
  const s={...defaultSettings};for(const key of Object.keys(defaultSettings)as(keyof Settings)[]){const value=key in data?data[key]:old[key];if(value===undefined)continue;const def=defaultSettings[key];if(typeof def==='boolean')(s as Input)[key]=!!value;else if(typeof def==='number')(s as Input)[key]=finite(value,Number(def));else (s as Input)[key]=text(value,32);}
  s.revealDelayMs=finite(s.revealDelayMs,900,0,10000);s.earlyPenaltyMs=finite(s.earlyPenaltyMs,750,0,10000);
  s.correctMultiplier=finite(s.correctMultiplier,1,0,100);s.wrongMultiplier=finite(s.wrongMultiplier,1,0,100);
  s.buzzMode='first';s.autoOpenBuzzers=true;s.lockWrong=true;s.reopenWrong=true;if(!['score','unlimited'].includes(s.finalMaxWager))s.finalMaxWager='score';return s;
}
/** Discard retired settings and countdown fields in saved games and undo snapshots. */
export function normalizeStoredGameplay(state:Pick<Game,'settings'|'rounds'|'current'>&Partial<Pick<Game,'selection'|'roundIndex'|'finalCategorySelection'>>){
  for(const field of ['hostToken','hostClaimable','hostTransfer'])delete(state as unknown as Input)[field];
  state.settings=normalizeSettings(state.settings);state.selection??=null;
  const activeRoundId=state.roundIndex===undefined?undefined:state.rounds[state.roundIndex]?.id;
  state.rounds=numberRounds(orderRounds(state.rounds));
  if(activeRoundId)state.roundIndex=state.rounds.findIndex(r=>r.id===activeRoundId);
  if(state.finalCategorySelection){
    const selection=state.finalCategorySelection,round=state.rounds.find(r=>r.id===selection.roundId&&r.type==='final');
    if(!round)delete state.finalCategorySelection;
    else selection.rejectedCategoryIds=[...new Set(Array.isArray(selection.rejectedCategoryIds)?selection.rejectedCategoryIds:[])].filter(id=>round.categories.some(c=>c.id===id)).slice(0,Math.max(0,round.categories.length-1));
  }
  for(const round of state.rounds)for(const category of round.categories)for(const question of category.questions)delete(question as unknown as Input).timer;
  if(state.current){
    delete(state.current as unknown as Input).timer;
    const round=state.rounds.find(r=>r.categories.some(c=>c.questions.some(q=>q.id===state.current!.questionId)));const q=round?.categories.flatMap(c=>c.questions).find(q=>q.id===state.current!.questionId);
    if(round?.type==='final'&&state.current.phase==='final'&&state.current.answersLocked===undefined)state.current.answersLocked=state.current.closed||state.current.revealed||!!state.current.revealAt||Object.values(state.current.wagers).some(e=>e.judged);
    for(const entry of Object.values(state.current.wagers))entry.answerSubmitted??=!!entry.answer.trim();
    // Legacy active Daily Doubles return to assignment before accepting another wager.
    if(q?.dailyDouble&&round?.type!=='final'&&!state.current.closed&&!state.current.dailyDoubleFromId){
      Object.assign(state.current,{dailyDoubleFromId:null,phase:'wager',answeringId:null,wagers:{},buzzOpen:false,buzzes:[],revealAt:null,revealed:false});
    }
  }
}
/** Resume saved regular questions in the first-buzz decision flow. */
export function normalizeBuzzerFlow(g:Game){
  syncFinalPresentation(g);
  const c=g.current,q=currentQuestion(g);
  if(!c||!q||q.modifier||q.dailyDouble||g.rounds[g.roundIndex].type==='final'||c.phase!=='question')return;
  if(c.closed){
    c.buzzOpen=false;c.answerToken=null;
    if(!c.revealed&&c.revealAt===null)reveal(g,Date.now());
    return;
  }
  if(c.revealed||c.revealAt!==null){c.buzzOpen=false;return;}
  c.closed=false;
  if(c.answeringId&&g.players.some(t=>t.id===c.answeringId)&&!c.attempted.includes(c.answeringId)){
    c.answerToken??=uid();c.buzzOpen=false;c.buzzes=c.buzzes.filter(b=>b.playerId===c.answeringId);
  }else{c.answeringId=null;c.answerToken=null;c.buzzes=[];c.buzzOpen=true;}
}
function normalizeTheme(data:Input,old=defaultTheme):Theme {
  const t={...old};for(const k of ['accent','paper','ink','surface','muted','line']as const){if(typeof data[k]==='string'&&/^#[0-9a-f]{6}$/i.test(data[k]))t[k]=data[k];}
  if(data.preset in themes)t.preset=data.preset;t.background=/^(https?:\/\/|\/media\/)/.test(data.background)?text(data.background,2000):data.background===''?'':old.background;
  if(['serif','sans'].includes(data.displayFont))t.displayFont=data.displayFont;if(typeof data.motion==='boolean')t.motion=data.motion;if(typeof data.sound==='boolean')t.sound=data.sound;if(typeof data.title==='string')t.title=text(data.title,70);return t;
}
function normalizeRounds(data:unknown):Round[]{
  assert(Array.isArray(data)&&data.length>0&&data.length<=20,'Use 1–20 rounds');const ids=new Set<string>();
  const id=(s:unknown)=>{let n=text(s,60)||uid();if(ids.has(n))n=uid();ids.add(n);return n;};
  const rounds:Round[]=(data as Input[]).map((r,i)=>{assert(Array.isArray(r.categories)&&r.categories.length<=(r.type==='final'?20:10),r.type==='final'?'Use up to 20 final categories':'Use up to 10 categories');return{id:id(r.id),name:text(r.name,60)||`Round ${i+1}`,type:r.type==='final'?'final':'board',categories:r.categories.map((c:Input)=>{assert(Array.isArray(c.questions)&&c.questions.length<=(r.type==='final'?1:12),r.type==='final'?'Each final category must contain one question':'Use up to 12 questions per category');return{id:id(c.id),name:text(c.name,60)||'Category',questions:c.questions.map((q:Input)=>{
    const question:Question={id:id(q.id),value:Math.round(finite(q.value,100,0,1e7)),prompt:text(q.prompt,100000),answer:text(q.answer,100000),notes:text(q.notes,20000),dailyDouble:!!q.dailyDouble&&!q.modifier&&r.type!=='final',modifier:r.type==='final'||!q.modifier?null:{title:text(q.modifier.title,80)||'Mystery modifier',instructions:text(q.modifier.instructions,20000)}};
    if(r.type==='final')question.responseType='free';
    else if(q.responseType!==undefined)question.responseType=q.responseType==='free'?'free':'answer';
    if(q.slowReveal!==undefined)question.slowReveal=q.slowReveal===true;
    if(r.type!=='final'&&q.responseType!=='free'&&q.answerOptions!==undefined){
      assert(Array.isArray(q.answerOptions),'Answer options must be a list');
      const answerOptions:string[]=q.answerOptions.length?q.answerOptions.map((option:unknown)=>text(option,100000)):[question.answer];
      while(answerOptions.length<2)answerOptions.push('');
      question.correctAnswerIndex=Math.round(finite(q.correctAnswerIndex,Math.max(0,answerOptions.indexOf(question.answer)),0,answerOptions.length-1));
      question.answerOptions=answerOptions;question.answer=answerOptions[question.correctAnswerIndex];
    }
    if(r.type!=='final'&&q.responseType!=='free'&&(q.answerOptions!==undefined||q.shuffleAnswers!==undefined))question.shuffleAnswers=q.shuffleAnswers!==false;
    return question;
  })};})};});
  return numberRounds(orderRounds(rounds));
}
export function updateDefinition(g:Game,data:Input){
  // Normalize everything first: malformed imports must not partially mutate a game.
  const rounds=data.rounds?normalizeRounds(data.rounds):g.rounds;
  const settings=data.settings?normalizeSettings(data.settings,g.settings):g.settings,theme=data.theme?normalizeTheme(data.theme,g.theme):g.theme;
  if(g.current)assert(rounds.some(r=>r.categories.some(c=>c.questions.some(q=>q.id===g.current?.questionId))),'Close the current question before deleting it');
  if(g.current){
    const nextQuestion=rounds.flatMap(r=>r.categories.flatMap(c=>c.questions)).find(q=>q.id===g.current!.questionId)!;
    assert(!!nextQuestion.modifier===(g.current.phase==='modifier'),'Return to the board before changing the question type');
  }
  const activeRoundId=g.rounds[g.roundIndex]?.id;g.rounds=rounds;g.settings=settings;g.theme=theme;if(data.name!==undefined)g.name=text(data.name,80)||'Untitled game';if(data.subtitle!==undefined)g.subtitle=text(data.subtitle,160);
  const next=rounds.findIndex(r=>r.id===activeRoundId);g.roundIndex=next>=0?next:Math.min(g.roundIndex,rounds.length-1);g.revision++;
}
/** Keep only board-to-question checkpoints from both current and older saves. */
export function normalizeQuestionUndo(g:Game){
  const snapshots=g.undo.filter((value):value is Game&{undoKind?:string}=>!!value&&typeof value==='object'&&Array.isArray((value as Game).players)&&Array.isArray((value as Game).rounds));
  const trace=[...snapshots,g];
  g.undo=g.status!=='playing'?[]:snapshots.filter((before,i)=>{
    const after=trace[i+1];
    if(before.roundIndex!==g.roundIndex||before.status!=='playing')return false;
    return before.undoKind==='questionSelection'||!before.current&&!before.selection&&after.roundIndex===before.roundIndex&&after.status==='playing'&&!!(after.current||after.selection);
  }).map(state=>({...state,undoKind:'questionSelection'}));
}
function snapshot(g:Game){const{undo,members:_members,...rest}=g;g.undo.push({...clone(rest),undoKind:'questionSelection'});if(g.undo.length>35)g.undo.shift();}
function log(g:Game,label:string,before:Record<string,number>){g.history.unshift({id:uid(),at:Date.now(),label,deltas:Object.fromEntries(g.players.filter(p=>p.score!==(before[p.id]??p.score)).map(p=>[p.id,p.score-(before[p.id]??p.score)]))});g.history=g.history.slice(0,100);g.revision++;}
function setScore(g:Game,p:Player,value:number){value=Math.round(finite(value,p.score));if(!g.settings.allowNegative)value=Math.max(0,value);p.score=value;}
/** Recover a pre-ledger result from recorded score changes, including score floors. */
function recoverJudgmentDelta(g:Game,team:Player,result:'correct'|'incorrect',amount:number):number{
  const opening=g.history.findIndex(h=>/^(Question opened ·|Question selected ·|Round ·|Game started$)/.test(h.label));
  const entries=opening>=0?g.history.slice(0,opening):g.history;
  const grades=entries.filter(h=>[`${team.name} · correct`,`${team.name} · incorrect`,`${team.name} · no answer`].includes(h.label));
  if(grades.length){
    // With an opening marker, the sum also handles corrections already made.
    if(opening>=0)return grades.reduce((total,h)=>total+(h.deltas[team.id]||0),0);
    return grades[0].deltas[team.id]||0;
  }
  const states=[...g.undo,g] as Game[];
  for(let i=states.length-1;i>0;i--){
    const before=states[i-1],after=states[i];
    if(before.current?.questionId!==g.current?.questionId||after.current?.questionId!==g.current?.questionId)continue;
    const a=before.players.find(t=>t.id===team.id),b=after.players.find(t=>t.id===team.id);
    if(a&&b&&(a.stats.correct!==b.stats.correct||a.stats.incorrect!==b.stats.incorrect))return b.score-a.score;
  }
  // Very old states without history use their original scoring rules.
  const penalty=g.settings.deductWrong||g.rounds[g.roundIndex].type==='final'||currentQuestion(g)?.dailyDouble;
  const points=result==='correct'?amount*g.settings.correctMultiplier:penalty?-amount*g.settings.wrongMultiplier:0;
  return !g.settings.allowNegative&&points<0&&team.score===0?0:Math.round(points);
}
/** Keep the pre-final scores visible while the presenter privately records results. */
function syncFinalPresentation(g:Game){
  const round=g.rounds[g.roundIndex];
  if(g.status==='lobby'||round.type!=='final'){delete g.finalPresentation;return;}
  if(!g.finalPresentation||g.finalPresentation.roundId!==round.id){
    g.finalPresentation={roundId:round.id,wagers:{},scores:Object.fromEntries(g.players.map(team=>{
      const judgment=g.current?.judgments?.[team.id],entry=g.current?.wagers[team.id];
      const result=judgment?.result||(entry?.judged?(entry.correct?'correct':'incorrect'):null);
      const delta=typeof judgment?.delta==='number'?judgment.delta:result&&result!=='pass'?recoverJudgmentDelta(g,team,result,entry?.wager||0):0;
      return[team.id,team.score-delta];
    }))};
  }
  if(g.current)for(const[id,entry]of Object.entries(g.current.wagers))g.finalPresentation.wagers[id]=entry.wager;
}
function selectableQuestion(g:Game,qid:string){
  const r=g.rounds[g.roundIndex];const c=r.categories.find(c=>c.questions.some(q=>q.id===qid));const q=c?.questions.find(q=>q.id===qid);assert(q&&c,'Question not found');assert(!g.played.includes(qid),'This question has already been played');assert(isQuestionFilled(q!),'This question is empty');
  if(r.type==='final'&&r.categories.length>1){
    const selection=g.finalCategorySelection;
    const remaining=r.categories.filter(category=>!selection?.rejectedCategoryIds.includes(category.id));
    assert(selection?.roundId===r.id&&remaining.length===1&&remaining[0].id===c!.id,'Cross out final categories until only one remains');
  }
  return {r,c:c!,q:q!};
}
function open(g:Game,qid:string,now:number){
  const {r,c,q}=selectableQuestion(g,qid);
  if(g.presenter){g.presenter.mediaPlaying=false;g.presenter.version++;}
  g.questionCount++;g.current={openedAt:now,answerToken:null,dailyDoubleFromId:null,questionId:qid,category:c!.name,buzzOpen:!!q!.modifier||r.type==='board'&&!q!.dailyDouble,buzzes:[],answeringId:null,attempted:[],revealAt:null,revealed:false,phase:q!.modifier?'modifier':r.type==='final'||q!.dailyDouble?'wager':'question',wagers:{},closed:false};
  if(!q.modifier&&q.responseType!=='free'&&q.shuffleAnswers!==false&&q.answerOptions&&q.answerOptions.length>1){
    const order=q.answerOptions.map((_,i)=>i);
    for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
    g.current.answerOrder=order;
  }
}
function syncImageReveal(g:Game,now:number){
  const c=g.current,q=currentQuestion(g);
  if(!c||!q?.slowReveal||c.openedAt===undefined)return;
  const answering=c.phase==='question'&&!q.dailyDouble&&!!c.answeringId&&!c.closed&&!c.revealed&&c.revealAt===null;
  const paused=g.status==='playing'&&(g.paused||answering);
  if(paused)c.imageRevealPausedAt??=now;
  else if(c.imageRevealPausedAt!==undefined){
    c.imageRevealPausedMs=(c.imageRevealPausedMs||0)+Math.max(0,now-c.imageRevealPausedAt);
    delete c.imageRevealPausedAt;
  }
}
function reveal(g:Game,now:number){assert(g.current,'Open a question first');if(g.presenter){g.presenter.mediaPlaying=false;g.presenter.version++;}g.current!.buzzOpen=false;g.current!.revealAt=now+g.settings.revealDelayMs;g.current!.revealed=g.settings.revealDelayMs===0;}
function finish(g:Game,now:number){
  assert(g.status!=='finished','This game has already ended');
  if(g.rounds[g.roundIndex].type==='final')assert(g.current?.phase==='final'&&g.current.answersLocked&&g.players.length&&g.players.every(t=>g.current!.wagers[t.id]?.judged),'Lock answers and mark every team Correct or Incorrect before finishing');
  if(g.presenter){g.presenter.mediaPlaying=false;g.presenter.version++;}
  delete g.resultsSkipped;g.undo=[];g.status='finished';g.paused=false;g.selection=null;
  if(g.current){
    g.current.buzzOpen=false;
    if(g.rounds[g.roundIndex].type==='final'&&g.current.phase==='final'){
      g.current.closed=true;g.current.revealed=true;g.current.revealAt=now;
      if(!g.played.includes(g.current.questionId))g.played.push(g.current.questionId);
    }
  }
}
function nextRound(g:Game,index:number,now:number){assert(g.players.length,'Create at least one team before starting');if(g.status==='lobby')assert(g.players.every(p=>p.ready),'Wait until all teams are ready');assert(index>=0&&index<g.rounds.length,'No such round');g.roundIndex=index;g.current=null;g.selection=null;g.paused=false;g.status='playing';g.teamsLocked=true;g.undo=[];syncFinalPresentation(g);if(g.rounds[index].type==='final'){const round=g.rounds[index];if(g.finalCategorySelection?.roundId!==round.id)g.finalCategorySelection={roundId:round.id,rejectedCategoryIds:[]};if(round.categories.length===1){const q=round.categories[0].questions[0];if(q&&isQuestionFilled(q))open(g,q.id,now);}}else delete g.finalCategorySelection;}

/** All gameplay mutations run synchronously on the server. No client supplies a score or a buzz timestamp. */
export function act(g:Game,action:string,data:Input={},role:'host'|'player'='host',playerId:string|null=null,now=Date.now()){
  assert(role==='host'||['buzz','ready','wager','finalAnswer'].includes(action),'Host access required');
  const self=g.players.find(p=>p.id===playerId);if(role==='player')assert(self,'Join the game first');
  if(action==='reset'){
    delete g.finalPresentation;delete g.finalCategorySelection;delete g.resultsSkipped;
    Object.assign(g,{status:'lobby',paused:false,roundIndex:0,teamsLocked:false,members:[],players:[],played:[],current:null,modifierClaims:[],history:[],undo:[],questionCount:0,selection:null,announcement:null,revision:g.revision+1});
    return;
  }
  if(action==='controlPresenterMedia'){
    const c=g.current;
    assert(c&&c.questionId===data.questionId&&['question','final'].includes(c.phase),'This audio clue is no longer active');
    assert(['start','stop','restart'].includes(data.operation),'Choose Start, Stop or Restart');
    assert(typeof data.source==='string'&&data.source.length>0&&data.source.length<=4096,'Choose an audio source');
    assert(data.operation==='stop'||!g.paused,'Resume the game before playing audio');
    g.presenter??={fullscreen:false,sound:false,mediaPlaying:false,version:0};
    const p=g.presenter;
    p.mediaSource=data.source;p.mediaPlaying=data.operation!=='stop';
    if(p.mediaPlaying)p.sound=true;
    p.mediaCommandVersion=(p.mediaCommandVersion||0)+1;
    if(data.operation!=='start')p.mediaResetVersion=(p.mediaResetVersion||0)+1;
    p.version++;g.revision++;return;
  }
  if(action==='setPresenter'){
    const keys=['fullscreen','sound','mediaPlaying'] as const;
    assert(keys.some(key=>key in data),'Choose a presenter control');
    for(const key of keys)if(key in data)assert(typeof data[key]==='boolean','Presenter controls must be on or off');
    g.presenter??={fullscreen:false,sound:false,mediaPlaying:false,version:0};
    for(const key of keys)if(key in data)g.presenter[key]=data[key];
    if('mediaPlaying' in data){g.presenter.mediaCommandVersion=(g.presenter.mediaCommandVersion||0)+1;delete g.presenter.mediaSource;}
    g.presenter.version++;g.revision++;return;
  }
  if(action==='skipResults'){
    assert(g.status==='finished','Finish the game before skipping its results');
    g.resultsSkipped=true;g.revision++;return;
  }
  if(action==='ready'){assert(g.status==='lobby','The game has already started');assert(self,'Team not found');self!.ready=!!data.ready;g.revision++;return;}
  if(action==='buzz'&&g.current?.phase==='modifier'){
    const c=g.current,q=currentQuestion(g);
    assert(g.status==='playing'&&!g.paused,'Game is not running');
    assert(self&&q?.modifier&&c.buzzOpen&&!c.closed&&!c.revealAt&&!c.revealed,'This modifier has already been claimed');
    const before=scores(g);
    c.answeringId=playerId;c.buzzes=[{playerId:playerId!,at:now,order:1}];c.closed=true;
    g.modifierClaims??=[];
    g.modifierClaims.push({id:uid(),questionId:q!.id,playerId:playerId!,roundIndex:g.roundIndex,...clone(q!.modifier!)});
    reveal(g,now);
    log(g,`${self!.name} claimed a mystery modifier`,before);
    return;
  }
  if(action==='buzz'){
    assert(g.status==='playing'&&!g.paused,'Game is not running');const c=g.current;assert(c&&c.phase==='question'&&!c.revealed&&!c.revealAt&&!c.closed,'No active question');assert(!currentQuestion(g)?.dailyDouble,'Only the assigned team answers this Daily Double');assert(self&&self.blockedUntil<=now,'Your button is temporarily blocked');
    if(!c!.buzzOpen){assert(!c!.answeringId,'Another team is answering');if(g.settings.earlyPenaltyMs>0){self!.blockedUntil=now+g.settings.earlyPenaltyMs;g.revision++;}throw new Error('Buzzers are closed');}
    assert(!c!.attempted.includes(playerId!),'Your team already attempted this question');assert(!c!.buzzes.some(b=>b.playerId===playerId),'Your team already buzzed');assert(!c!.answeringId,'Another team is answering');
    c!.buzzes.push({playerId:playerId!,at:now,order:c!.buzzes.length+1});self!.stats.buzzes++;if(!c!.answeringId){c!.answeringId=playerId;c!.answerToken=uid();c!.buzzOpen=false;}syncImageReveal(g,now);g.revision++;return;
  }
  if(action==='wager'||action==='finalAnswer'){
    assert(g.status==='playing'&&!g.paused,'Game is not running');
    const c=g.current,q=currentQuestion(g);
    assert(!q?.dailyDouble,'The presenter records Daily Double wagers');
    assert(c&&data.questionId===c.questionId,'This question is no longer active');
    assert(g.rounds[g.roundIndex].type==='final','No active final');
    const entry=c!.wagers[playerId!];
    if(action==='wager'){
      assert(c!.phase==='wager'&&!c!.closed,'Wagers are closed');
      assert(data.version===(entry?.wagerVersion||0),'Your teammate updated the wager. Review the saved wager and try again.');
      const max=finalWagerLimit(g.finalPresentation?.scores[playerId!]??self!.score,g.settings.finalMaxWager);
      assert(Number.isInteger(data.wager)&&data.wager>=0&&data.wager<=max,`Enter a whole wager between 0 and ${max}`);
      c!.wagers[playerId!]={wager:data.wager,answer:'',submitted:true,judged:false,wagerVersion:(entry?.wagerVersion||0)+1,answerVersion:entry?.answerVersion||0,answerSubmitted:false};
      syncFinalPresentation(g);
    }else{
      assert(c!.phase==='final'&&!c!.answersLocked&&!c!.revealAt&&!c!.revealed&&!c!.closed,'Answers are closed');
      assert(entry?.submitted,'Submit your wager first');
      assert(data.version===(entry!.answerVersion||0),'Your teammate updated the answer. Review the saved answer and try again.');
      assert(typeof data.answer==='string'&&data.answer.length<=5000,'Use up to 5000 characters');
      entry!.answer=data.answer;entry!.answerSubmitted=!!data.answer.trim();entry!.answerVersion=(entry!.answerVersion||0)+1;
    }
    g.revision++;return;
  }
  if(action==='undo'){
    normalizeQuestionUndo(g);
    assert(g.undo.length,'Nothing to undo');
    const{undoKind:_kind,...state}=g.undo.pop()as Omit<Game,'undo'|'members'>&{undoKind:string};
    // Undo gameplay without restoring departed players or changing a locked roster.
    const undo=g.undo,members=g.members,teamsLocked=g.teamsLocked,teams=g.players,paused=g.paused,presenter=g.presenter;
    Object.assign(g,state,{undo,revision:g.revision+1,members,teamsLocked,paused});
    if(presenter)g.presenter=presenter;else delete g.presenter;
    if(teamsLocked)g.players=teams.map(team=>({...team,...g.players.find(saved=>saved.id===team.id),name:team.name,color:team.color,token:team.token}));
    for(const team of g.players)team.connected=members.some(m=>m.teamId===team.id&&m.connected);
    normalizeStoredGameplay(g);delete(g as Input).chooserId;if(g.current)delete(g.current as Input).selectionPlayerId;
    return;
  }
  if(['addTeam','addPlayer','removeTeam','renameTeam','renamePlayer'].includes(action)){
    assert(g.status==='lobby'&&!g.teamsLocked,'Teams are fixed after the game starts');
    if(action==='addTeam'||action==='addPlayer')addPlayer(g,text(data.name));
    else{
      const team=g.players.find(t=>t.id===data.playerId);assert(team,'Team not found');
      if(action==='removeTeam'){
        g.players=g.players.filter(t=>t.id!==team!.id);g.members=g.members.filter(m=>m.teamId!==team!.id);
      }else{
        const name=text(data.name,32).trim();assert(name,'Enter a team name');
        assert(!g.players.some(t=>t.id!==team!.id&&t.name.toLowerCase()===name.toLowerCase()),'A team with this name already exists');team!.name=name;
      }
    }
    g.undo=[];g.revision++;return;
  }
  if(action==='removePlayer'){removeMember(g,text(data.memberId));return;}
  const backup=clone(g);const before=scores(g);if(['selectQuestion','openQuestion'].includes(action))snapshot(g);
  try{
    let label='';const c=g.current,q=currentQuestion(g);
    switch(action){
      case'save':assert(g.status==='lobby','This game has started. Make a copy to edit it.');updateDefinition(g,data);label='Game settings updated';break;
      case'start':assert(g.status==='lobby','Game has already started');assert(g.players.length,'Create at least one team before starting');assert(g.players.every(p=>p.ready),'Wait until all teams are ready');nextRound(g,0,now);label='Game started';break;
      case'setFinalCategoryRejected':{
        const round=g.rounds[g.roundIndex];
        assert(g.status==='playing'&&!g.paused&&round.type==='final'&&!c&&!g.selection,'Final category selection is closed');
        assert(data.roundId===round.id,'This final round is no longer active');
        assert(round.categories.some(category=>category.id===data.categoryId),'Category not found');
        assert(typeof data.rejected==='boolean','Choose whether to cross out this category');
        const selection=g.finalCategorySelection??={roundId:round.id,rejectedCategoryIds:[]};
        assert(selection.roundId===round.id,'This final round is no longer active');
        const rejected=new Set(selection.rejectedCategoryIds);
        if(data.rejected){
          assert(rejected.has(data.categoryId)||round.categories.length-rejected.size>1,'Keep one final category');
          rejected.add(data.categoryId);
        }else rejected.delete(data.categoryId);
        selection.rejectedCategoryIds=[...rejected];label='Final categories updated';break;
      }
      case'chooseFinalCategory':{
        const round=g.rounds[g.roundIndex];
        assert(g.status==='playing'&&!g.paused&&round.type==='final'&&!c&&!g.selection,'Final category selection is closed');
        assert(data.roundId===round.id,'This final round is no longer active');
        const remaining=round.categories.filter(category=>!g.finalCategorySelection?.rejectedCategoryIds.includes(category.id));
        assert(remaining.length===1,'Cross out final categories until only one remains');
        const question=remaining[0].questions[0];assert(question&&isQuestionFilled(question),'Add a question to the remaining category before playing');
        open(g,question.id,now);label=`Final category · ${remaining[0].name}`;break;
      }
      case'selectQuestion':{
        assert(g.status==='playing'&&!g.paused,'Start or resume the game first');assert(!c&&!g.selection,'A question is already selected');
        const {q}=selectableQuestion(g,text(data.questionId));
        g.selection={questionId:q.id,opensAt:now+QUESTION_SELECTION_MS};label=`Question selected · ${q.value}`;break;
      }
      case'openQuestion':assert(g.status==='playing'&&!g.paused,'Start or resume the game first');assert(!c&&!g.selection,'Close the current question first');open(g,text(data.questionId),now);label=`Question opened · ${currentQuestion(g)?.value}`;break;
      case'continueQuestion':{
        assert(g.status==='playing'&&!g.paused&&c,'No active question');
        assert(data.questionId===c!.questionId,'This question is no longer active');
        assert(c!.phase==='question'||c!.phase==='final','Open the question before continuing');
        if(g.rounds[g.roundIndex].type==='final'){
          assert(c!.phase==='final'&&c!.answersLocked&&g.players.length&&g.players.every(team=>c!.wagers[team.id]?.judged),'Mark every team Correct or Incorrect before finishing');
          finish(g,now);label='Game finished';break;
        }
        assert(q?.dailyDouble||g.rounds[g.roundIndex].type==='final'||c!.closed||c!.revealed||c!.revealAt!==null,'Judge the answering team or end this question');
        assert(c!.revealAt===null||c!.revealed,'Wait until the answer is revealed');
        if(hasCorrectResult(c!)&&!c!.revealed){reveal(g,now);label='Answer revealed';}
        else{if(!g.played.includes(c!.questionId))g.played.push(c!.questionId);g.current=null;label='Question closed';}
        break;
      }
      case'endQuestion':{
        assert(g.status==='playing'&&!g.paused&&c&&q&&c.phase==='question','No active question');
        assert(!q!.dailyDouble&&!q!.modifier&&g.rounds[g.roundIndex].type==='board','Use the controls for this special question');
        assert(data.questionId===c!.questionId,'This question is no longer active');
        c!.closed=true;c!.buzzOpen=false;c!.answerToken=null;c!.buzzes=[];
        if(!hasCorrectResult(c!))c!.answeringId=null;
        if(!c!.revealed&&c!.revealAt===null)reveal(g,now);
        label='Question ended · answer revealed';break;
      }
      case'closeQuestion':assert(g.rounds[g.roundIndex].type!=='final','Finish the game after judging all final answers');assert(c,'No active question');if(!g.played.includes(c!.questionId))g.played.push(c!.questionId);g.current=null;label='Question closed';break;
      case'openBuzzers':assert(!q?.dailyDouble,'Daily Double has one required answerer');assert(c&&!c.revealed&&!c.revealAt&&c.phase==='question'&&!c.closed&&!g.paused,'No active question');c!.buzzOpen=true;c!.answeringId=null;c!.buzzes=[];label='Buzzers opened';break;
      case'closeBuzzers':assert(c,'No question');c!.buzzOpen=false;label='Buzzers closed';break;
      case'resetBuzzers':assert(!q?.dailyDouble,'Daily Double has one required answerer');assert(c&&c.phase==='question'&&!c.revealed&&!c.revealAt&&!c.closed,'Question is closed');c!.buzzes=[];c!.answeringId=null;c!.attempted=[];c!.buzzOpen=true;label='Buzzers reset';break;
      case'answerer':assert(!q?.dailyDouble,'Daily Double has one required answerer');assert(c&&c.phase==='question'&&!c.closed&&!c.revealAt,'No active question');assert(g.players.some(p=>p.id===data.playerId),'Choose a team');c!.answeringId=data.playerId;c!.answerToken=uid();c!.buzzOpen=false;label='Answering team changed';break;
      case'setDailyDoubleChooser':{
        assert(g.status==='playing'&&!g.paused&&c?.phase==='wager'&&q?.dailyDouble,'No Daily Double awaiting assignment');
        assert(g.players.length>=2,'Add at least two teams to play this Daily Double');
        const from=g.players.find(p=>p.id===data.playerId);assert(from,'Choose the team that selected this question');
        c!.dailyDoubleFromId=from!.id;c!.answeringId=null;c!.wagers={};c!.buzzOpen=false;c!.buzzes=[];
        label=`${from!.name} is choosing a Daily Double opponent`;break;
      }
      case'assignDailyDouble':{
        assert(g.status==='playing'&&!g.paused&&c?.phase==='wager'&&q?.dailyDouble,'No Daily Double awaiting assignment');
        const from=g.players.find(p=>p.id===data.fromId),to=g.players.find(p=>p.id===data.playerId);
        assert(from&&to,'Choose the selecting team and the team that must answer');assert(from!.id!==to!.id,'Give the Daily Double to a different team');
        if(c!.dailyDoubleFromId!==from!.id||c!.answeringId!==to!.id)c!.wagers={};
        c!.dailyDoubleFromId=from!.id;c!.answeringId=to!.id;c!.buzzOpen=false;c!.buzzes=[];
        label=`${from!.name} gave the Daily Double to ${to!.name}`;break;
      }
      case'resolveAnswer':{
        assert(g.status==='playing'&&!g.paused&&c&&q&&c.phase==='question'&&!c.closed&&!c.revealed&&c.revealAt===null,'No active answer');
        assert(!q!.dailyDouble&&!q!.modifier&&g.rounds[g.roundIndex].type==='board','Use the controls for this special question');
        assert(data.questionId===c!.questionId,'This question is no longer active');
        assert(c!.answeringId&&data.playerId===c!.answeringId&&data.answerToken&&data.answerToken===c!.answerToken,'This team is no longer answering');
        const result=data.result===undefined?(typeof data.correct==='boolean'?data.correct?'correct':'incorrect':null):data.result;
        assert(['correct','incorrect','pass'].includes(result),'Choose Correct, Incorrect or Pass');
        assert(data.points===undefined,'Adjust scores through the team controls');
        const team=g.players.find(t=>t.id===c!.answeringId);assert(team,'Team not found');
        const correct=result==='correct',points=result==='pass'?0:Math.round(correct?q!.value*g.settings.correctMultiplier:g.settings.deductWrong?-q!.value*g.settings.wrongMultiplier:0);
        const beforeScore=team!.score;setScore(g,team!,team!.score+points);if(result!=='pass')team!.stats[correct?'correct':'incorrect']++;
        (c!.judgments??={})[team!.id]={result,delta:team!.score-beforeScore};
        if(correct){
          c!.closed=true;c!.answerToken=null;c!.buzzes=[];
          if(!c!.attempted.includes(team!.id))c!.attempted.push(team!.id);
          reveal(g,now);
        }
        else{
          if(!c!.attempted.includes(team!.id))c!.attempted.push(team!.id);
          c!.answeringId=null;c!.answerToken=null;c!.buzzes=[];c!.buzzOpen=true;
        }
        label=`${team!.name} · ${result==='pass'?'passed':result}`;break;
      }
      case'gradeTeam':{
        assert(g.status==='playing'&&!g.paused&&c&&q,'No active question');
        assert(data.questionId===c!.questionId,'This question is no longer active');
        assert(c!.phase==='question'||c!.phase==='final','Open the question before recording results');
        const isFinal=g.rounds[g.roundIndex].type==='final';
        const dailyDouble=q!.dailyDouble&&!isFinal;
        assert(isFinal||dailyDouble,'Wait for a team to buzz, then judge its answer');
        assert(['correct','incorrect','pass'].includes(data.result),'Choose Correct, Incorrect or Pass');
        const team=g.players.find(t=>t.id===data.playerId);assert(team,'Team not found');
        // Migrate earlier results on demand so every result can be revised directly.
        c!.judgments??={};
        for(const oldTeam of g.players){
          const oldEntry=c!.wagers[oldTeam.id];
          if(!c!.judgments[oldTeam.id]&&(isFinal||dailyDouble?oldEntry?.judged:c!.attempted.includes(oldTeam.id))){
            const correct=isFinal||dailyDouble?oldEntry!.correct:c!.closed&&c!.answeringId===oldTeam.id;
            c!.judgments[oldTeam.id]={result:correct?'correct':'incorrect',delta:null};
          }
          const oldJudgment=c!.judgments[oldTeam.id];
          if(oldJudgment?.delta===null)oldJudgment.delta=oldJudgment.result==='pass'?0:recoverJudgmentDelta(g,oldTeam,oldJudgment.result,isFinal||dailyDouble?(oldEntry?.wager||0):q!.value);
        }
        const previous=c!.judgments[team!.id],entry=c!.wagers[team!.id];
        if(dailyDouble){
          assert(c!.dailyDoubleFromId&&c!.answeringId===team!.id&&entry?.submitted,'Only the assigned team answers the Daily Double');
          assert(data.result!=='pass','The assigned team must answer the Daily Double');
        }
        if(isFinal){assert(c!.answersLocked,'Lock answers before judging');assert(data.result!=='pass','Choose Correct or Incorrect');assert(entry?.submitted,'Record and lock the wager first');}
        const result=data.result as 'correct'|'incorrect'|'pass';
        const amount=isFinal||dailyDouble?entry!.wager:q!.value;
        const points=result==='correct'?amount*g.settings.correctMultiplier:result==='incorrect'&&(g.settings.deductWrong||isFinal||dailyDouble)?-amount*g.settings.wrongMultiplier:0;
        const beforeScore=team!.score;
        setScore(g,team!,beforeScore-(previous?.delta||0)+points);
        const delta=team!.score-(beforeScore-(previous?.delta||0));
        if(previous&&previous.result!=='pass')team!.stats[previous.result]=Math.max(0,team!.stats[previous.result]-1);
        if(result!=='pass')team!.stats[result]++;
        (c!.judgments??={})[team!.id]={result,delta};
        if(isFinal||dailyDouble){entry!.judged=result!=='pass';entry!.correct=result==='pass'?undefined:result==='correct';if(dailyDouble){c!.closed=true;c!.buzzOpen=false;}}
        else{
          c!.attempted=c!.attempted.filter(id=>id!==team!.id);
          if(result==='correct'||result==='incorrect'&&g.settings.lockWrong)c!.attempted.push(team!.id);
          c!.buzzes=c!.buzzes.filter(b=>b.playerId!==team!.id);
          if(c!.answeringId===team!.id)c!.answeringId=null;
          const correct=Object.entries(c!.judgments!).find(([,judgment])=>judgment.result==='correct');
          c!.closed=!!correct;
          if(correct){c!.answeringId=correct[0];c!.buzzOpen=false;}
          else{
            if(!c!.answeringId&&g.settings.buzzMode==='queue')c!.answeringId=c!.buzzes.find(b=>!c!.attempted.includes(b.playerId))?.playerId||null;
            c!.buzzOpen=!c!.revealAt&&!c!.revealed&&!c!.answeringId&&g.settings.reopenWrong;
          }
        }
        label=`${team!.name} · ${result==='pass'?'no answer':result}`;break;
      }
      case'judge':{
        assert(c?.phase!=='modifier','Modifiers are applied manually');
        assert(g.status==='playing'&&!g.paused&&c&&q&&!c.closed,'No active question');assert(c!.phase!=='wager','Finish wagering first');const p=g.players.find(p=>p.id===(data.playerId||c!.answeringId));assert(p,'Choose a team');const isFinal=g.rounds[g.roundIndex].type==='final',entry=c!.wagers[p!.id];if(q!.dailyDouble&&!isFinal)assert(p!.id===c!.answeringId&&c!.dailyDoubleFromId&&entry?.submitted,'Only the assigned team can answer the Daily Double');if(isFinal){assert(c!.answersLocked,'Lock answers before judging');assert(entry&&!entry.judged,'This final answer has already been judged');}else assert(!c!.attempted.includes(p!.id),'This team has already answered');
        const amount=isFinal||q!.dailyDouble?(entry?.wager||0):q!.value;const correct=!!data.correct;const delta=correct?amount*g.settings.correctMultiplier:g.settings.deductWrong||isFinal||q!.dailyDouble?-amount*g.settings.wrongMultiplier:0;
        const oldScore=p!.score;setScore(g,p!,p!.score+delta);(c!.judgments??={})[p!.id]={result:correct?'correct':'incorrect',delta:p!.score-oldScore};p!.stats[correct?'correct':'incorrect']++;if(isFinal||q!.dailyDouble){entry.judged=true;entry.correct=correct;}if(!isFinal){c!.attempted.push(p!.id);if(correct||q!.dailyDouble){c!.closed=true;c!.buzzOpen=false;}else{c!.answeringId=null;if(g.settings.lockWrong)c!.buzzes=c!.buzzes.filter(b=>b.playerId!==p!.id&&!c!.attempted.includes(b.playerId));else{c!.attempted=c!.attempted.filter(id=>id!==p!.id);c!.buzzes=[];}const queued=g.settings.buzzMode==='queue'?c!.buzzes.find(b=>!c!.attempted.includes(b.playerId)):null;if(queued){c!.answeringId=queued.playerId;}c!.buzzOpen=g.settings.reopenWrong&&!queued;}}
        label=`${p!.name} · ${correct?'correct':'incorrect'}`;break;
      }
      case'reveal':assert(g.rounds[g.roundIndex].type!=='final','Finish the game to reveal the final answer');assert(!(q?.dailyDouble&&c?.phase==='wager'),'Assign a team and lock the wager first');assert(c?.phase!=='modifier'||c.answeringId,'Wait for someone to claim the modifier');reveal(g,now);label='Answer revealed';break;
      case'finalBegin':{
        assert(g.status==='playing'&&!g.paused&&c?.phase==='wager','No wagering round');
        if(q?.dailyDouble){
          assert(c!.dailyDoubleFromId&&c!.dailyDoubleFromId!==c!.answeringId&&g.players.some(p=>p.id===c!.dailyDoubleFromId)&&c!.answeringId&&g.players.some(p=>p.id===c!.answeringId)&&c!.wagers[c!.answeringId]?.submitted,'Assign another team and collect its chosen wager');c!.phase='question';c!.buzzOpen=false;
        }else{
          assert(g.players.length&&g.players.every(p=>c!.wagers[p.id]?.submitted),'Record a wager for every team before locking');
          c!.phase='final';c!.answersLocked=false;
        }
        c!.openedAt=now;
        label='Wagers locked';break;
      }
      case'lockFinalAnswers':{
        assert(g.status==='playing'&&!g.paused&&c?.phase==='final'&&!c.closed&&!c.answersLocked&&data.questionId===c.questionId,'Answers are closed');
        c!.answersLocked=true;label='Answers locked';break;
      }
      case'hostFinalEntry':{
        assert(g.status==='playing'&&!g.paused&&c&&g.rounds[g.roundIndex].type==='final'&&!c.closed&&data.questionId===c.questionId,'No active final');
        assert(c!.phase==='wager'||c!.phase==='final','No active final');
        const team=g.players.find(t=>t.id===data.playerId);assert(team,'Team not found');
        const entry=c!.wagers[team!.id];
        assert(data.wagerVersion===(entry?.wagerVersion||0)&&data.answerVersion===(entry?.answerVersion||0),'This submission changed. Review the saved submission and try again.');
        const max=finalWagerLimit(g.finalPresentation?.scores[team!.id]??team!.score,g.settings.finalMaxWager);
        assert(Number.isInteger(data.wager)&&data.wager>=0&&data.wager<=max,`Enter a whole wager between 0 and ${max}`);
        assert(typeof data.answer==='string'&&data.answer.length<=5000,'Use up to 5000 characters');
        assert(c!.phase!=='wager'||!data.answer,'Lock wagers before recording an answer');
        if(entry?.judged){
          const result=entry.correct?'correct':'incorrect',previous=c!.judgments?.[team!.id];
          const delta=typeof previous?.delta==='number'?previous.delta:recoverJudgmentDelta(g,team!,result,entry.wager);
          const beforeScore=team!.score,points=data.wager*(entry.correct?g.settings.correctMultiplier:-g.settings.wrongMultiplier);
          setScore(g,team!,beforeScore-delta+points);
          (c!.judgments??={})[team!.id]={result,delta:team!.score-(beforeScore-delta)};
        }
        c!.wagers[team!.id]={wager:data.wager,answer:data.answer,submitted:true,answerSubmitted:!!data.answer.trim(),judged:entry?.judged||false,correct:entry?.correct,wagerVersion:(entry?.wagerVersion||0)+1,answerVersion:(entry?.answerVersion||0)+1};
        label='Final submission updated';break;
      }
      case'hostWager':{
        assert(g.status==='playing'&&!g.paused&&c?.phase==='wager','Wagers are closed');
        const p=g.players.find(p=>p.id===data.playerId);assert(p,'Choose a team');
        if(q?.dailyDouble)assert(c!.dailyDoubleFromId&&c!.answeringId===p!.id,'Record the wager for the assigned team');
        const max=q?.dailyDouble?1e7:finalWagerLimit(g.finalPresentation?.scores[p!.id]??p!.score,g.settings.finalMaxWager);
        assert(Number.isInteger(data.wager)&&data.wager>=0&&data.wager<=max,`Enter a whole wager between 0 and ${max}`);
        const old=c!.wagers[p!.id];
        c!.wagers[p!.id]={wager:data.wager,answer:'',submitted:true,judged:false,answerSubmitted:false,wagerVersion:(old?.wagerVersion||0)+1,answerVersion:old?.answerVersion||0};label='Wager set';break;
      }
      case'pause':g.paused=!g.paused;label=g.paused?'Game paused':'Game resumed';break;
      case'round':nextRound(g,Math.round(finite(data.index)),now);label=`Round · ${g.rounds[g.roundIndex].name}`;break;
      case'dismissModifier':{
        assert(g.modifierClaims?.some(m=>m.id===data.id),'Modifier not found');
        g.modifierClaims=g.modifierClaims.filter(m=>m.id!==data.id);label='Modifier reminder dismissed';break;
      }
      case'finish':finish(g,now);label='Game finished';break;
      case'resume':assert(g.players.length,'Create at least one team before starting');if(g.status==='lobby')assert(g.players.every(p=>p.ready),'Wait until all teams are ready');g.teamsLocked=true;g.status='playing';g.paused=false;label='Game resumed';break;
      case'adjust':{const p=g.players.find(p=>p.id===data.playerId);assert(p,'Team not found');setScore(g,p!,data.mode==='set'?finite(data.amount):p!.score+finite(data.amount));label=`${p!.name} · score adjusted`;break;}
      case'adjustScores':{
        assert(Array.isArray(data.scores)&&data.scores.length>0&&data.scores.length<=g.players.length,'Choose scores to update');
        const ids=new Set<string>();
        const updates=data.scores.map((entry:Input)=>{
          assert(entry&&typeof entry==='object','Invalid score update');
          const team=g.players.find(team=>team.id===entry.playerId);assert(team,'Team not found');
          assert(!ids.has(team!.id),'A team can only be updated once');ids.add(team!.id);
          assert(typeof entry.amount==='number'&&Number.isFinite(entry.amount)&&Math.abs(entry.amount)<=1e9,'Enter a valid score');
          return{team:team!,amount:entry.amount};
        });
        for(const{team,amount}of updates)setScore(g,team,amount);
        label='Team scores adjusted';break;
      }
      default:throw new Error('Unknown action');
    }
    syncImageReveal(g,now);
    syncFinalPresentation(g);
    log(g,label,before);
  }catch(error){Object.assign(g,backup);throw error;}
}
export function tick(g:Game,now=Date.now()):boolean{
  if(g.paused||g.status!=='playing')return false;let changed=false;
  if(g.selection&&now>=g.selection.opensAt){const {questionId}=g.selection;g.selection=null;open(g,questionId,now);changed=true;}
  const c=g.current;
  if(c?.revealAt&&!c.revealed&&now>=c.revealAt){c.revealed=true;changed=true;}
  if(changed)g.revision++;return changed;
}
export function view(g:Game,role:GameView['role'],playerId?:string,now=Date.now(),memberId?:string):GameView{
  const{hostTransfer:_legacyHostTransfer,hostToken:_legacyHostToken,hostClaimable:_legacyHostClaimable,undo,players,members,modifiers:_legacyModifiers,uses:_legacyUses,...base}=g as Game&{hostTransfer?:unknown;hostToken?:unknown;hostClaimable?:unknown;modifiers?:unknown;uses?:unknown};const q=currentQuestion(g);const reveal=role==='host'||(g.rounds[g.roundIndex].type==='final'?g.status==='finished':!!g.current?.revealed);const final=g.rounds[g.roundIndex].type==='final';const holdFinal=role!=='host'&&final&&g.status!=='finished';
  const rounds=g.rounds.map(r=>({...r,categories:r.categories.map(c=>({...c,questions:c.questions.map(q=>{
    if(role==='host')return clone(q);
    const{answerOptions:_options,correctAnswerIndex:_correct,...question}=q;
    return{...question,prompt:'',answer:'',notes:'',modifier:null};
  })}))}));
  const cur=g.current?clone(g.current):null;
  if(cur){
    const judgments=g.current!.judgments||{};
    cur.passedTeamIds=g.players.filter(t=>judgments[t.id]?.result==='pass').map(t=>t.id);
    cur.incorrectTeamIds=g.players.filter(t=>judgments[t.id]?.result==='incorrect'||!judgments[t.id]&&cur.attempted.includes(t.id)&&!(cur.closed&&cur.answeringId===t.id)).map(t=>t.id);
  }
  if(cur&&holdFinal){cur.incorrectTeamIds=[];cur.passedTeamIds=[];}
  if(cur&&role!=='host'){delete cur.answerOrder;delete cur.judgments;delete cur.answerToken;cur.wagers=Object.fromEntries(Object.entries(cur.wagers).map(([id,e])=>[id,{wager:reveal||q?.dailyDouble||role==='player'&&id===playerId?e.wager:0,answer:reveal||role==='player'&&id===playerId?e.answer:'',submitted:e.submitted,answerSubmitted:e.answerSubmitted,judged:holdFinal?false:e.judged,correct:reveal&&!holdFinal?e.correct:undefined}]));}
  let cq=q?clone(q):null;
  const order=g.current?.answerOrder;
  if(cq?.answerOptions&&order){const options=cq.answerOptions;cq.answerOptions=order.map(i=>options[i]);cq.correctAnswerIndex=order.indexOf(cq.correctAnswerIndex??0);}
  if(cq&&role!=='host'){delete cq.correctAnswerIndex;if(!reveal){cq.answer='';cq.modifier=null;}cq.notes='';if(cur?.phase==='wager'){cq.prompt='';delete cq.answerOptions;}if(cur?.phase==='modifier'){cq.prompt='';cq.answer='';delete cq.answerOptions;if(!reveal)cq.modifier=null;}}
  const publicBase=clone(base);
  if(holdFinal){publicBase.history=[];publicBase.announcement=null;if(publicBase.finalPresentation)publicBase.finalPresentation.wagers={};}
  const own=role==='player'&&playerId&&g.current?.wagers[playerId]?clone(g.current.wagers[playerId]):null;
  if(own&&holdFinal){own.judged=false;delete own.correct;}
  return{...publicBase,canUndo:role==='host'&&g.undo.length>0,modifierClaims:clone(g.modifierClaims||[]).filter(m=>role==='host'||m.questionId!==cur?.questionId||cur.revealed),filledQuestionIds:g.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions.filter(isQuestionFilled).map(q=>q.id))),settings:normalizeSettings(g.settings),rounds,members:(members||[]).filter(m=>role==='host'||role==='player'&&m.teamId===playerId).map(({token,...m})=>clone(m)),selfMemberId:memberId,players:(players as (Player&{shield?:number})[]).map(({token,shield:_legacyShield,...p})=>({...clone(p),score:holdFinal?g.finalPresentation?.scores[p.id]??p.score:p.score,...(holdFinal?{stats:{correct:0,incorrect:0,buzzes:0}}:{})})),current:cur,role,serverTime:now,selfId:playerId,currentQuestion:cq,yourFinal:own};
}

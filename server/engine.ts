import {randomBytes} from 'node:crypto';
import {defaultSettings,defaultTheme,emptyRound,uid,themes,isQuestionFilled} from '../shared/model.ts';
import type {Game,GameView,Player,Settings,Theme,Round} from '../shared/model.ts';

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
  const g:Game={id:randomBytes(3).toString('hex').toUpperCase(),name:text(input.name)||'Untitled game',subtitle:'',hostToken:token(),createdAt:Date.now(),status:'lobby',paused:false,roundIndex:0,rounds:[emptyRound()],modifierClaims:[],settings:clone(defaultSettings),theme:clone(defaultTheme),players:[],played:[],current:null,history:[],undo:[],questionCount:0,announcement:null,revision:0};
  if(input.definition)updateDefinition(g,input.definition);
  return g;
}
export function addPlayer(g:Game,name:string):Player {
  assert(g.status!=='finished','This game has ended');assert(g.players.length<g.settings.maxPlayers,'This room is full');
  assert(g.status==='lobby'||g.settings.allowLateJoin,'Joining is closed');
  name=text(name.trim(),32);assert(name,'Enter your name');assert(!g.players.some(p=>p.name.toLowerCase()===name.toLowerCase()),'This name is already taken');
  const p:Player={id:uid(),token:token(),name,color:colors[g.players.length%colors.length],score:g.settings.startingScore,connected:false,ready:false,blockedUntil:0,stats:{correct:0,incorrect:0,buzzes:0},joinedAt:Date.now()};g.players.push(p);g.revision++;return p;
}
export function normalizeSettings(data:Input,old=defaultSettings):Settings {
  const s={...defaultSettings};for(const key of Object.keys(defaultSettings)as(keyof Settings)[]){const value=key in data?data[key]:old[key];if(value===undefined)continue;const def=defaultSettings[key];if(typeof def==='boolean')(s as Input)[key]=!!value;else if(typeof def==='number')(s as Input)[key]=finite(value,Number(def));else (s as Input)[key]=text(value,32);}
  s.maxPlayers=Math.round(finite(s.maxPlayers,32,1,100));s.revealDelayMs=finite(s.revealDelayMs,900,0,10000);s.earlyPenaltyMs=finite(s.earlyPenaltyMs,750,0,10000);
  s.correctMultiplier=finite(s.correctMultiplier,1,0,100);s.wrongMultiplier=finite(s.wrongMultiplier,1,0,100);
  if(!['first','queue'].includes(s.buzzMode))s.buzzMode='first';if(!['score','unlimited'].includes(s.finalMaxWager))s.finalMaxWager='score';return s;
}
/** Discard retired countdown fields in saved games and undo snapshots. */
export function normalizeStoredGameplay(state:Pick<Game,'settings'|'rounds'|'current'>){
  state.settings=normalizeSettings(state.settings);
  for(const round of state.rounds)for(const category of round.categories)for(const question of category.questions)delete(question as unknown as Input).timer;
  if(state.current)delete(state.current as unknown as Input).timer;
}
function normalizeTheme(data:Input,old=defaultTheme):Theme {
  const t={...old};for(const k of ['accent','paper','ink','surface','muted','line']as const){if(typeof data[k]==='string'&&/^#[0-9a-f]{6}$/i.test(data[k]))t[k]=data[k];}
  if(data.preset in themes)t.preset=data.preset;t.background=/^(https?:\/\/|\/media\/)/.test(data.background)?text(data.background,2000):data.background===''?'':old.background;
  if(['serif','sans'].includes(data.displayFont))t.displayFont=data.displayFont;if(typeof data.motion==='boolean')t.motion=data.motion;if(typeof data.sound==='boolean')t.sound=data.sound;if(typeof data.title==='string')t.title=text(data.title,70);return t;
}
function normalizeRounds(data:unknown):Round[]{
  assert(Array.isArray(data)&&data.length>0&&data.length<=20,'Use 1–20 rounds');const ids=new Set<string>();
  const id=(s:unknown)=>{let n=text(s,60)||uid();if(ids.has(n))n=uid();ids.add(n);return n;};
  return (data as Input[]).map((r,i)=>{assert(Array.isArray(r.categories)&&r.categories.length<=10,'Use up to 10 categories');return{id:id(r.id),name:text(r.name,60)||`Round ${i+1}`,type:r.type==='final'?'final':'board',categories:r.categories.map((c:Input)=>{assert(Array.isArray(c.questions)&&c.questions.length<=12,'Use up to 12 questions per category');return{id:id(c.id),name:text(c.name,60)||'Category',questions:c.questions.map((q:Input)=>({id:id(q.id),value:Math.round(finite(q.value,100,0,1e7)),prompt:text(q.prompt,100000),answer:text(q.answer,100000),notes:text(q.notes,20000),dailyDouble:!!q.dailyDouble&&!q.modifier,modifier:r.type==='final'||!q.modifier?null:{title:text(q.modifier.title,80)||'Mystery modifier',instructions:text(q.modifier.instructions,20000)}}))};})};});
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
function snapshot(g:Game){const{undo,...rest}=g;g.undo.push(clone(rest));if(g.undo.length>35)g.undo.shift();}
function log(g:Game,label:string,before:Record<string,number>){g.history.unshift({id:uid(),at:Date.now(),label,deltas:Object.fromEntries(g.players.filter(p=>p.score!==(before[p.id]??p.score)).map(p=>[p.id,p.score-(before[p.id]??p.score)]))});g.history=g.history.slice(0,100);g.revision++;}
function setScore(g:Game,p:Player,value:number){value=Math.round(finite(value,p.score));if(!g.settings.allowNegative)value=Math.max(0,value);p.score=value;}
function open(g:Game,qid:string,now:number,dailyDoublePlayerId:string|null=null){
  const r=g.rounds[g.roundIndex];const c=r.categories.find(c=>c.questions.some(q=>q.id===qid));const q=c?.questions.find(q=>q.id===qid);assert(q&&c,'Question not found');assert(!g.played.includes(qid),'This question has already been played');assert(isQuestionFilled(q!),'This question is empty');
  g.questionCount++;g.current={questionId:qid,category:c!.name,buzzOpen:!!q!.modifier||g.settings.autoOpenBuzzers&&!q!.dailyDouble,buzzes:[],answeringId:null,attempted:[],revealAt:null,revealed:false,phase:q!.modifier?'modifier':r.type==='final'||q!.dailyDouble?'wager':'question',wagers:{},closed:false};
  if(q!.dailyDouble&&dailyDoublePlayerId)g.current.answeringId=dailyDoublePlayerId;

}
function reveal(g:Game,now:number){assert(g.current,'Open a question first');g.current!.buzzOpen=false;g.current!.revealAt=now+g.settings.revealDelayMs;g.current!.revealed=g.settings.revealDelayMs===0;}
function nextRound(g:Game,index:number,now:number){assert(index>=0&&index<g.rounds.length,'No such round');g.roundIndex=index;g.current=null;g.paused=false;g.status='playing';if(g.rounds[index].type==='final'){const q=g.rounds[index].categories.flatMap(c=>c.questions).find(q=>q.prompt.trim());if(q)open(g,q.id,now);}}

/** All gameplay mutations run synchronously on the server. No client supplies a score or a buzz timestamp. */
export function act(g:Game,action:string,data:Input={},role:'host'|'player'='host',playerId:string|null=null,now=Date.now()){
  assert(role==='host'||['buzz','ready','wager','finalAnswer'].includes(action),'Host access required');
  const self=g.players.find(p=>p.id===playerId);if(role==='player')assert(self,'Join the game first');
  if(action==='reset'){
    Object.assign(g,{status:'lobby',paused:false,roundIndex:0,players:[],played:[],current:null,modifierClaims:[],history:[],undo:[],questionCount:0,announcement:null,revision:g.revision+1});
    return;
  }
  if(action==='ready'){assert(self,'Player not found');self!.ready=!!data.ready;g.revision++;return;}
  if(action==='buzz'&&g.current?.phase==='modifier'){
    const c=g.current,q=currentQuestion(g);
    assert(g.status==='playing'&&!g.paused,'Game is not running');
    assert(self&&q?.modifier&&c.buzzOpen&&!c.closed&&!c.revealAt&&!c.revealed,'This modifier has already been claimed');
    const before=scores(g);snapshot(g);
    c.answeringId=playerId;c.buzzes=[{playerId:playerId!,at:now,order:1}];c.closed=true;
    g.modifierClaims??=[];
    g.modifierClaims.push({id:uid(),questionId:q!.id,playerId:playerId!,roundIndex:g.roundIndex,...clone(q!.modifier!)});
    reveal(g,now);
    log(g,`${self!.name} claimed a mystery modifier`,before);
    return;
  }
  if(action==='buzz'){
    assert(g.status==='playing'&&!g.paused,'Game is not running');const c=g.current;assert(c&&c.phase==='question'&&!c.revealed&&!c.revealAt&&!c.closed,'No active question');assert(self&&self.blockedUntil<=now,'Your button is temporarily blocked');
    if(!c!.buzzOpen){if(g.settings.earlyPenaltyMs>0){self!.blockedUntil=now+g.settings.earlyPenaltyMs;g.revision++;}throw new Error('Buzzers are closed');}
    assert(!c!.attempted.includes(playerId!),'You already attempted this question');assert(!c!.buzzes.some(b=>b.playerId===playerId),'You already buzzed');assert(g.settings.buzzMode==='queue'||!c!.answeringId,'Another player is answering');
    c!.buzzes.push({playerId:playerId!,at:now,order:c!.buzzes.length+1});self!.stats.buzzes++;if(!c!.answeringId){c!.answeringId=playerId;if(g.settings.buzzMode==='first')c!.buzzOpen=false;}g.revision++;return;
  }
  if(action==='wager'){
    assert(g.status==='playing'&&!g.paused,'Game is not running');const c=g.current,q=currentQuestion(g);assert(c&&c.phase==='wager'&&self,'Wagers are closed');if(q?.dailyDouble)assert(c!.answeringId===playerId,'Only the selected player can wager');assert(!c!.wagers[playerId!]?.submitted,'Wager is locked');const max=g.settings.finalMaxWager==='unlimited'?1e7:Math.max(0,self!.score,q?.dailyDouble?q.value:0);const wager=Math.round(finite(data.wager,0,0,max));c!.wagers[playerId!]={wager,answer:'',submitted:true,judged:false};g.revision++;return;
  }
  if(action==='finalAnswer'){
    assert(g.status==='playing'&&!g.paused,'Game is not running');const c=g.current;assert(c&&c.phase==='final'&&!c.revealAt&&!c.revealed&&!c.closed,'Answers are closed');const entry=c!.wagers[playerId!];assert(entry,'Submit your wager first');entry.answer=text(data.answer,5000);entry.submitted=true;g.revision++;return;
  }
  if(action==='undo'){
    assert(g.undo.length,'Nothing to undo');const state=g.undo.pop()as Omit<Game,'undo'>;const undo=g.undo;const revision=g.revision+1;Object.assign(g,state,{undo,revision});normalizeStoredGameplay(g);delete(g as Input).chooserId;if(g.current)delete(g.current as Input).selectionPlayerId;return;
  }
  const backup=clone(g);const before=scores(g);if(!['save','pause'].includes(action))snapshot(g);
  try{
    let label='';const c=g.current,q=currentQuestion(g);
    switch(action){
      case'save':updateDefinition(g,data);label='Game settings updated';break;
      case'start':assert(g.status==='lobby','Game has already started');assert(!g.settings.requireReady||g.players.every(p=>p.ready),'Wait until everyone is ready');nextRound(g,0,now);label='Game started';break;
      case'openQuestion':assert(g.status==='playing'&&!g.paused,'Start or resume the game first');assert(!c,'Close the current question first');open(g,text(data.questionId),now,text(data.playerId)||null);label=`Question opened · ${currentQuestion(g)?.value}`;break;
      case'closeQuestion':assert(c,'No active question');if(!g.played.includes(c!.questionId))g.played.push(c!.questionId);g.current=null;label='Question closed';break;
      case'openBuzzers':assert(c&&!c.revealed&&!c.revealAt&&c.phase==='question'&&!c.closed&&!g.paused,'No active question');c!.buzzOpen=true;c!.answeringId=null;c!.buzzes=[];label='Buzzers opened';break;
      case'closeBuzzers':assert(c,'No question');c!.buzzOpen=false;label='Buzzers closed';break;
      case'resetBuzzers':assert(c&&c.phase==='question'&&!c.revealed&&!c.revealAt&&!c.closed,'Question is closed');c!.buzzes=[];c!.answeringId=null;c!.attempted=[];c!.buzzOpen=true;label='Buzzers reset';break;
      case'answerer':assert(c&&c.phase==='question'&&!c.closed&&!c.revealAt,'No active question');assert(g.players.some(p=>p.id===data.playerId),'Choose a player');c!.answeringId=data.playerId;c!.buzzOpen=false;label='Answering player changed';break;
      case'judge':{
        assert(c?.phase!=='modifier','Modifiers are applied manually');
        assert(g.status==='playing'&&!g.paused&&c&&q&&!c.closed,'No active question');assert(c!.phase!=='wager','Finish wagering first');const p=g.players.find(p=>p.id===(data.playerId||c!.answeringId));assert(p,'Choose a player');const isFinal=g.rounds[g.roundIndex].type==='final',entry=c!.wagers[p!.id];if(isFinal)assert(entry&&!entry.judged,'This final answer has already been judged');else assert(!c!.attempted.includes(p!.id),'This player has already answered');
        const amount=isFinal||q!.dailyDouble?(entry?.wager||0):q!.value;const correct=!!data.correct;const delta=correct?amount*g.settings.correctMultiplier:g.settings.deductWrong||isFinal||q!.dailyDouble?-amount*g.settings.wrongMultiplier:0;
        setScore(g,p!,p!.score+delta);p!.stats[correct?'correct':'incorrect']++;if(isFinal){entry.judged=true;entry.correct=correct;}else{c!.attempted.push(p!.id);if(correct||q!.dailyDouble){c!.closed=true;reveal(g,now);}else{c!.answeringId=null;if(g.settings.lockWrong)c!.buzzes=c!.buzzes.filter(b=>b.playerId!==p!.id&&!c!.attempted.includes(b.playerId));else{c!.attempted=c!.attempted.filter(id=>id!==p!.id);c!.buzzes=[];}const queued=g.settings.buzzMode==='queue'?c!.buzzes.find(b=>!c!.attempted.includes(b.playerId)):null;if(queued){c!.answeringId=queued.playerId;}c!.buzzOpen=g.settings.reopenWrong&&!queued;}}
        label=`${p!.name} · ${correct?'correct':'incorrect'}`;break;
      }
      case'reveal':assert(c?.phase!=='modifier'||c.answeringId,'Wait for someone to claim the modifier');reveal(g,now);label='Answer revealed';break;
      case'finalBegin':assert(c&&c.phase==='wager','No wagering round');if(q?.dailyDouble){assert(c!.answeringId&&c!.wagers[c!.answeringId],'Choose a player and collect their wager');c!.phase='question';}else{for(const p of g.players)if(!c!.wagers[p.id])c!.wagers[p.id]={wager:0,answer:'',submitted:true,judged:false};c!.phase='final';}label='Wagers locked';break;
      case'hostWager':{assert(c&&c.phase==='wager','Wagers are closed');const p=g.players.find(p=>p.id===data.playerId);assert(p,'Choose a player');const max=g.settings.finalMaxWager==='unlimited'?1e7:Math.max(0,p!.score,q?.dailyDouble?q.value:0);c!.wagers[p!.id]={wager:Math.round(finite(data.wager,0,0,max)),answer:'',submitted:true,judged:false};if(q?.dailyDouble)c!.answeringId=p!.id;label=`${p!.name} · wager set`;break;}
      case'pause':g.paused=!g.paused;label=g.paused?'Game paused':'Game resumed';break;
      case'round':nextRound(g,Math.round(finite(data.index)),now);label=`Round · ${g.rounds[g.roundIndex].name}`;break;
      case'dismissModifier':{
        assert(g.modifierClaims?.some(m=>m.id===data.id),'Modifier not found');
        g.modifierClaims=g.modifierClaims.filter(m=>m.id!==data.id);label='Modifier reminder dismissed';break;
      }
      case'finish':g.status='finished';g.paused=false;if(c)c.buzzOpen=false;label='Game finished';break;
      case'resume':g.status='playing';g.paused=false;label='Game resumed';break;
      case'adjust':{const p=g.players.find(p=>p.id===data.playerId);assert(p,'Player not found');setScore(g,p!,data.mode==='set'?finite(data.amount):p!.score+finite(data.amount));label=`${p!.name} · score adjusted`;break;}
      case'addPlayer':{const p=addPlayer(g,text(data.name));label=`${p.name} added`;break;}
      case'removePlayer':assert(g.players.some(p=>p.id===data.playerId),'Player not found');g.players=g.players.filter(p=>p.id!==data.playerId);if(c&&c.answeringId===data.playerId)c.answeringId=null;label='Player removed';break;
      case'renamePlayer':{const p=g.players.find(p=>p.id===data.playerId);assert(p,'Player not found');p!.name=text(data.name,32)||p!.name;label='Player renamed';break;}
      default:throw new Error('Unknown action');
    }
    log(g,label,before);
  }catch(error){Object.assign(g,backup);throw error;}
}
export function tick(g:Game,now=Date.now()):boolean{
  if(!g.current||g.paused||g.status!=='playing')return false;let changed=false;const c=g.current;
  if(c.revealAt&&!c.revealed&&now>=c.revealAt){c.revealed=true;changed=true;}
  if(changed)g.revision++;return changed;
}
export function view(g:Game,role:GameView['role'],playerId?:string,now=Date.now()):GameView{
  const{hostToken,undo,players,modifiers:_legacyModifiers,uses:_legacyUses,...base}=g as Game&{modifiers?:unknown;uses?:unknown};const q=currentQuestion(g);const reveal=role==='host'||!!g.current?.revealed;
  const rounds=g.rounds.map(r=>({...r,categories:r.categories.map(c=>({...c,questions:c.questions.map(q=>role==='host'?clone(q):{...q,prompt:'',answer:'',notes:'',modifier:null})}))}));
  const cur=g.current?clone(g.current):null;if(cur&&role!=='host')cur.wagers=Object.fromEntries(Object.entries(cur.wagers).map(([id,e])=>[id,{wager:reveal?e.wager:0,answer:reveal?e.answer:'',submitted:e.submitted,judged:e.judged,correct:reveal?e.correct:undefined}]));
  let cq=q?clone(q):null;if(cq&&role!=='host'){if(!reveal){cq.answer='';cq.modifier=null;}cq.notes='';if(cur?.phase==='wager')cq.prompt='';if(cur?.phase==='modifier'){cq.prompt='';cq.answer='';if(!reveal)cq.modifier=null;}}
  return{...clone(base),modifierClaims:clone(g.modifierClaims||[]).filter(m=>role==='host'||m.questionId!==cur?.questionId||cur.revealed),filledQuestionIds:g.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions.filter(isQuestionFilled).map(q=>q.id))),settings:{...g.settings,joinPin:role==='host'?g.settings.joinPin:g.settings.joinPin?'required':''},rounds,players:(players as (Player&{shield?:number})[]).map(({token,shield:_legacyShield,...p})=>clone(p)),current:cur,role,serverTime:now,selfId:playerId,currentQuestion:cq,yourFinal:playerId&&g.current?.wagers[playerId]?clone(g.current.wagers[playerId]):null};
}

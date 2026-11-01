import {randomBytes} from 'node:crypto';
import {defaultSettings,defaultTheme,emptyRound,modifierTemplates,uid,themes,triggerLabels} from '../shared/model.ts';
import type {Game,GameView,Player,Modifier,Effect,Target,Settings,Theme,Round,Question,Current,Trigger} from '../shared/model.ts';

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
  const g:Game={id:randomBytes(3).toString('hex').toUpperCase(),name:text(input.name)||'Untitled game',subtitle:'',hostToken:token(),createdAt:Date.now(),status:'lobby',paused:false,roundIndex:0,rounds:[emptyRound()],modifiers:modifierTemplates(),settings:clone(defaultSettings),theme:clone(defaultTheme),players:[],played:[],current:null,history:[],undo:[],uses:{},questionCount:0,chooserId:null,announcement:null,revision:0};
  if(input.definition)updateDefinition(g,input.definition);
  return g;
}
export function addPlayer(g:Game,name:string):Player {
  assert(g.status!=='finished','This game has ended');assert(g.players.length<g.settings.maxPlayers,'This room is full');
  assert(g.status==='lobby'||g.settings.allowLateJoin,'Joining is closed');
  name=text(name.trim(),32);assert(name,'Enter your name');assert(!g.players.some(p=>p.name.toLowerCase()===name.toLowerCase()),'This name is already taken');
  const p:Player={id:uid(),token:token(),name,color:colors[g.players.length%colors.length],score:g.settings.startingScore,connected:false,ready:false,blockedUntil:0,shield:0,stats:{correct:0,incorrect:0,buzzes:0},joinedAt:Date.now()};g.players.push(p);g.revision++;return p;
}
export function normalizeSettings(data:Input,old=defaultSettings):Settings {
  const s={...old};for(const key of Object.keys(defaultSettings)as(keyof Settings)[]){if(!(key in data))continue;const value=data[key];const def=defaultSettings[key];if(typeof def==='boolean')(s as Input)[key]=!!value;else if(typeof def==='number')(s as Input)[key]=finite(value,Number(def));else (s as Input)[key]=text(value,32);}
  for(const key of ['questionSeconds','answerSeconds','finalSeconds']as const)s[key]=finite(s[key],30,0,3600);
  s.maxPlayers=Math.round(finite(s.maxPlayers,32,1,100));s.revealDelayMs=finite(s.revealDelayMs,900,0,10000);s.earlyPenaltyMs=finite(s.earlyPenaltyMs,750,0,10000);
  s.correctMultiplier=finite(s.correctMultiplier,1,0,100);s.wrongMultiplier=finite(s.wrongMultiplier,1,0,100);
  if(!['first','queue'].includes(s.buzzMode))s.buzzMode='first';if(!['lock','reveal','nothing'].includes(s.expiryAction))s.expiryAction='lock';if(!['host','winner'].includes(s.selection))s.selection='host';if(!['arrival','random'].includes(s.answerOrder))s.answerOrder='arrival';if(!['score','unlimited'].includes(s.finalMaxWager))s.finalMaxWager='score';return s;
}
function normalizeTheme(data:Input,old=defaultTheme):Theme {
  const t={...old};for(const k of ['accent','paper','ink','surface','muted','line']as const){if(typeof data[k]==='string'&&/^#[0-9a-f]{6}$/i.test(data[k]))t[k]=data[k];}
  if(data.preset in themes)t.preset=data.preset;t.background=/^(https?:\/\/|\/media\/)/.test(data.background)?text(data.background,2000):data.background===''?'':old.background;
  if(['serif','sans'].includes(data.displayFont))t.displayFont=data.displayFont;if(typeof data.motion==='boolean')t.motion=data.motion;if(typeof data.sound==='boolean')t.sound=data.sound;if(typeof data.title==='string')t.title=text(data.title,70);return t;
}
function normalizeRounds(data:unknown):Round[]{
  assert(Array.isArray(data)&&data.length>0&&data.length<=20,'Use 1–20 rounds');const ids=new Set<string>();
  const id=(s:unknown)=>{let n=text(s,60)||uid();if(ids.has(n))n=uid();ids.add(n);return n;};
  return (data as Input[]).map((r,i)=>{assert(Array.isArray(r.categories)&&r.categories.length<=10,'Use up to 10 categories');return{id:id(r.id),name:text(r.name,60)||`Round ${i+1}`,type:r.type==='final'?'final':'board',categories:r.categories.map((c:Input)=>{assert(Array.isArray(c.questions)&&c.questions.length<=12,'Use up to 12 questions per category');return{id:id(c.id),name:text(c.name,60)||'Category',questions:c.questions.map((q:Input)=>({id:id(q.id),value:Math.round(finite(q.value,100,0,1e7)),prompt:text(q.prompt,100000),answer:text(q.answer,100000),notes:text(q.notes,20000),modifierIds:Array.isArray(q.modifierIds)?q.modifierIds.filter((x:unknown)=>typeof x==='string').slice(0,20):[],timer:q.timer==null?null:finite(q.timer,30,0,3600),dailyDouble:!!q.dailyDouble}))};})};});
}
function normalizeModifiers(data:unknown):Modifier[]{
  assert(Array.isArray(data)&&data.length<=50,'Use up to 50 modifiers');const ids=new Set<string>();return(data as Input[]).map(m=>{
    let id=text(m.id,60)||uid();if(ids.has(id))id=uid();ids.add(id);
    const triggers=['manual','correct','incorrect','questionOpen','roundStart'];const targets=['actor','selected','leader','last','all','others','random'];const ops=['add','multiply','set','transfer','swap','clampMin','clampMax','block','shield'];
    assert(triggers.includes(m.trigger),'Unknown modifier trigger');assert(Array.isArray(m.effects)&&m.effects.length>0&&m.effects.length<=12,'Add 1–12 actions');
    const effects=m.effects.map((e:Input)=>{assert(ops.includes(e.type)&&targets.includes(e.target),'Unknown modifier action');assert(['fixed','question','actorScore','targetScore'].includes(e.source),'Unknown value source');return{id:text(e.id,60)||uid(),type:e.type,target:e.target,source:e.source,amount:finite(e.amount,0,-1000000,1000000)};});
    const conditions=(Array.isArray(m.conditions)?m.conditions:[]).slice(0,12).map((c:Input)=>{assert(['score','rank','round','questionValue'].includes(c.field)&&['gte','lte','eq','gt','lt'].includes(c.op),'Unknown condition');return{id:text(c.id,60)||uid(),subject:(c.subject==='target'?'target':'actor')as 'target'|'actor',field:c.field,op:c.op,value:finite(c.value)};});
    return{id,name:text(m.name,60)||'Untitled modifier',description:text(m.description,240),trigger:m.trigger,effects,conditions,enabled:!!m.enabled,playerUsable:!!m.playerUsable,usesPerPlayer:Math.round(finite(m.usesPerPlayer,0,0,100)),resetEachRound:!!m.resetEachRound,cost:finite(m.cost,0,0,1e7),cooldown:Math.round(finite(m.cooldown,0,0,100)),announce:m.announce!==false};
  });
}
export function updateDefinition(g:Game,data:Input){
  // Normalize everything first: malformed imports must not partially mutate a game.
  const rounds=data.rounds?normalizeRounds(data.rounds):g.rounds,modifiers=data.modifiers?normalizeModifiers(data.modifiers):g.modifiers;
  const settings=data.settings?normalizeSettings(data.settings,g.settings):g.settings,theme=data.theme?normalizeTheme(data.theme,g.theme):g.theme;
  if(g.current)assert(rounds.some(r=>r.categories.some(c=>c.questions.some(q=>q.id===g.current?.questionId))),'Close the current question before deleting it');
  const activeRoundId=g.rounds[g.roundIndex]?.id;g.rounds=rounds;g.modifiers=modifiers;g.settings=settings;g.theme=theme;if(data.name!==undefined)g.name=text(data.name,80)||'Untitled game';if(data.subtitle!==undefined)g.subtitle=text(data.subtitle,160);
  const next=rounds.findIndex(r=>r.id===activeRoundId);g.roundIndex=next>=0?next:Math.min(g.roundIndex,rounds.length-1);g.revision++;
}
function snapshot(g:Game){const{undo,...rest}=g;g.undo.push(clone(rest));if(g.undo.length>35)g.undo.shift();}
function log(g:Game,label:string,before:Record<string,number>){g.history.unshift({id:uid(),at:Date.now(),label,deltas:Object.fromEntries(g.players.filter(p=>p.score!==(before[p.id]??p.score)).map(p=>[p.id,p.score-(before[p.id]??p.score)]))});g.history=g.history.slice(0,100);g.revision++;}
function setScore(g:Game,p:Player,value:number,protect=false){value=Math.round(finite(value,p.score));if(!g.settings.allowNegative)value=Math.max(0,value);if(protect&&value<p.score&&p.shield>0){p.shield--;return;}p.score=value;}
function targets(g:Game,target:Target,actorId:string|null,selectedId:string|null):Player[]{
  const sorted=[...g.players].sort((a,b)=>b.score-a.score||a.joinedAt-b.joinedAt);switch(target){case'actor':return g.players.filter(p=>p.id===actorId);case'selected':return g.players.filter(p=>p.id===selectedId);case'leader':return sorted.slice(0,1);case'last':return sorted.slice(-1);case'all':return sorted;case'others':return sorted.filter(p=>p.id!==actorId);case'random':{const others=sorted.filter(p=>p.id!==actorId);return others.length?[others[Math.floor(Math.random()*others.length)]]:[];}}
}
export function modifierAvailability(g:Game,m:Modifier,actorId:string|null,selectedId:string|null,now=Date.now()):string|null{
  if(!m.enabled)return'Disabled';const actor=g.players.find(p=>p.id===actorId);if(!actor)return'Choose a player';
  if(m.effects.some(e=>e.target==='selected')&&!g.players.some(p=>p.id===selectedId&&p.id!==actorId))return'Choose another player';
  const key=`${m.id}:${actorId}:${m.resetEachRound?g.rounds[g.roundIndex].id:'game'}`,used=g.uses[key];
  if(m.usesPerPlayer&&used?.count>=m.usesPerPlayer)return'No uses left';if(used&&g.questionCount-used.lastQuestion<=m.cooldown&&m.cooldown>0)return'On cooldown';if(m.cost>0&&actor.score<m.cost)return'Not enough points';
  const sorted=[...g.players].sort((a,b)=>b.score-a.score);const target=g.players.find(p=>p.id===selectedId);
  for(const c of m.conditions){const p=c.subject==='target'?target:actor;if(!p)return'Condition not met';let value=c.field==='score'?p.score:c.field==='rank'?sorted.findIndex(x=>x.score===p.score)+1:c.field==='round'?g.roundIndex+1:(currentQuestion(g)?.value||0);let expected=c.value;if(c.field==='rank'&&expected===-1)expected=sorted.findIndex(x=>x.score===sorted.at(-1)!.score)+1;const ok=c.op==='gte'?value>=expected:c.op==='lte'?value<=expected:c.op==='gt'?value>expected:c.op==='lt'?value<expected:value===expected;if(!ok)return'Condition not met';}
  if(now<actor.blockedUntil&&m.playerUsable)return'Player is temporarily blocked';return null;
}
function applyEffect(g:Game,e:Effect,actor:Player,selectedId:string|null,now:number){
  for(const p of targets(g,e.target,actor.id,selectedId)){
    let value=e.amount*(e.source==='question'?(currentQuestion(g)?.value||0):e.source==='actorScore'?actor.score:e.source==='targetScore'?p.score:1);value=finite(value);
    switch(e.type){case'add':setScore(g,p,p.score+value,true);break;case'multiply':setScore(g,p,p.score*value,true);break;case'set':setScore(g,p,value,true);break;case'clampMin':setScore(g,p,Math.max(p.score,value));break;case'clampMax':setScore(g,p,Math.min(p.score,value),true);break;
      case'transfer':{if(p.id===actor.id)break;const amount=Math.max(0,Math.min(Math.round(value),Math.max(0,p.score)));const before=p.score;setScore(g,p,p.score-amount,true);setScore(g,actor,actor.score+Math.max(0,before-p.score));break;}
      case'swap':{if(p.id===actor.id)break;const a=actor.score,b=p.score;if((b<a&&actor.shield>0)||(a<b&&p.shield>0)){if(b<a)actor.shield--;else p.shield--;break;}setScore(g,actor,b);setScore(g,p,a);break;}
      case'block':p.blockedUntil=now+Math.max(0,value)*1000;break;case'shield':p.shield=Math.max(0,Math.min(100,p.shield+Math.round(value)));break;
    }
  }
}
export function applyModifier(g:Game,m:Modifier,actorId:string|null,selectedId:string|null,now=Date.now()){
  const error=modifierAvailability(g,m,actorId,selectedId,now);assert(!error,error||'Unavailable');const actor=g.players.find(p=>p.id===actorId)!;
  for(const e of m.effects)applyEffect(g,e,actor,selectedId,now);
  if(m.cost>0)setScore(g,actor,actor.score-m.cost);
  const key=`${m.id}:${actorId}:${m.resetEachRound?g.rounds[g.roundIndex].id:'game'}`;g.uses[key]={count:(g.uses[key]?.count||0)+1,lastQuestion:g.questionCount};
  if(m.announce)g.announcement={id:uid(),title:m.name,detail:actor.name,at:now};
}
function automatic(g:Game,trigger:Trigger,actorId:string|null,now:number){const q=currentQuestion(g);for(const m of g.modifiers.filter(m=>m.trigger===trigger&&m.enabled)){if(q&&q.modifierIds.length&&!q.modifierIds.includes(m.id)&&trigger==='questionOpen')continue;const target=[...g.players].filter(p=>p.id!==actorId).sort((a,b)=>b.score-a.score)[0]?.id||null;if(!modifierAvailability(g,m,actorId,target,now))applyModifier(g,m,actorId,target,now);}}
const timer=(seconds:number,running:boolean,now:number)=>({endsAt:running&&seconds>0?now+seconds*1000:null,remainingMs:seconds*1000,durationMs:seconds*1000,paused:!running});
function open(g:Game,qid:string,now:number,selectionPlayerId:string|null=null){
  const r=g.rounds[g.roundIndex];const c=r.categories.find(c=>c.questions.some(q=>q.id===qid));const q=c?.questions.find(q=>q.id===qid);assert(q&&c,'Question not found');assert(!g.played.includes(qid),'This question has already been played');assert(q!.prompt.trim(),'This question is empty');
  const seconds=q!.timer??(g.settings.timerEnabled?g.settings.questionSeconds:0);
  g.questionCount++;g.current={questionId:qid,category:c!.name,buzzOpen:g.settings.autoOpenBuzzers&&!q!.dailyDouble,buzzes:[],answeringId:null,attempted:[],revealAt:null,revealed:false,phase:r.type==='final'||q!.dailyDouble?'wager':'question',wagers:{},timer:timer(q!.dailyDouble||r.type==='final'?0:seconds,g.settings.autoStartTimer&&!q!.dailyDouble&&r.type!=='final',now),selectionPlayerId,closed:false};
  if(q!.dailyDouble&&selectionPlayerId)g.current.answeringId=selectionPlayerId;
  automatic(g,'questionOpen',g.chooserId||g.players[0]?.id||null,now);
}
function reveal(g:Game,now:number){assert(g.current,'Open a question first');g.current!.buzzOpen=false;if(g.current!.timer.endsAt)g.current!.timer.remainingMs=Math.max(0,g.current!.timer.endsAt-now);g.current!.timer.endsAt=null;g.current!.revealAt=now+g.settings.revealDelayMs;g.current!.revealed=g.settings.revealDelayMs===0;}
function nextRound(g:Game,index:number,now:number){assert(index>=0&&index<g.rounds.length,'No such round');g.roundIndex=index;g.current=null;g.paused=false;g.status='playing';automatic(g,'roundStart',g.chooserId||g.players[0]?.id||null,now);if(g.rounds[index].type==='final'){const q=g.rounds[index].categories.flatMap(c=>c.questions).find(q=>q.prompt.trim());if(q)open(g,q.id,now);}}

/** All gameplay mutations run synchronously on the server. No client supplies a score or a buzz timestamp. */
export function act(g:Game,action:string,data:Input={},role:'host'|'player'='host',playerId:string|null=null,now=Date.now()){
  assert(role==='host'||['buzz','ready','modifier','wager','finalAnswer','selectQuestion'].includes(action),'Host access required');
  const self=g.players.find(p=>p.id===playerId);if(role==='player')assert(self,'Join the game first');
  if(action==='ready'){assert(self,'Player not found');self!.ready=!!data.ready;g.revision++;return;}
  if(action==='buzz'){
    assert(g.status==='playing'&&!g.paused,'Game is not running');const c=g.current;assert(c&&c.phase==='question'&&!c.revealed&&!c.revealAt&&!c.closed,'No active question');assert(self&&self.blockedUntil<=now,'Your button is temporarily blocked');
    if(!c!.buzzOpen){if(g.settings.earlyPenaltyMs>0){self!.blockedUntil=now+g.settings.earlyPenaltyMs;g.revision++;}throw new Error('Buzzers are closed');}
    assert(!c!.attempted.includes(playerId!),'You already attempted this question');assert(!c!.buzzes.some(b=>b.playerId===playerId),'You already buzzed');assert(g.settings.buzzMode==='queue'||!c!.answeringId,'Another player is answering');
    c!.buzzes.push({playerId:playerId!,at:now,order:c!.buzzes.length+1});self!.stats.buzzes++;if(!c!.answeringId){c!.answeringId=playerId;if(g.settings.buzzMode==='first')c!.buzzOpen=false;if(g.settings.timerEnabled&&g.settings.answerSeconds)c!.timer=timer(g.settings.answerSeconds,true,now);}g.revision++;return;
  }
  if(action==='wager'){
    assert(g.status==='playing'&&!g.paused,'Game is not running');const c=g.current,q=currentQuestion(g);assert(c&&c.phase==='wager'&&self,'Wagers are closed');if(q?.dailyDouble)assert(c!.answeringId===playerId,'Only the selected player can wager');assert(!c!.wagers[playerId!]?.submitted,'Wager is locked');const max=g.settings.finalMaxWager==='unlimited'?1e7:Math.max(0,self!.score,q?.dailyDouble?q.value:0);const wager=Math.round(finite(data.wager,0,0,max));c!.wagers[playerId!]={wager,answer:'',submitted:true,judged:false};g.revision++;return;
  }
  if(action==='finalAnswer'){
    assert(g.status==='playing'&&!g.paused,'Game is not running');const c=g.current;assert(c&&c.phase==='final'&&!c.revealAt&&!c.revealed&&!c.closed,'Answers are closed');assert(c!.timer.remainingMs>0||c!.timer.durationMs===0||c!.timer.endsAt!==null,'Time is up');const entry=c!.wagers[playerId!];assert(entry,'Submit your wager first');entry.answer=text(data.answer,5000);entry.submitted=true;g.revision++;return;
  }
  if(action==='undo'){
    assert(g.undo.length,'Nothing to undo');const state=g.undo.pop()as Omit<Game,'undo'>;const undo=g.undo;const revision=g.revision+1;Object.assign(g,state,{undo,revision});return;
  }
  const backup=clone(g);const before=scores(g);if(!['save','timerPause','timerStart','pause'].includes(action))snapshot(g);
  try{
    let label='';const c=g.current,q=currentQuestion(g);
    switch(action){
      case'save':updateDefinition(g,data);label='Game settings updated';break;
      case'start':assert(g.status==='lobby','Game has already started');assert(!g.settings.requireReady||g.players.every(p=>p.ready),'Wait until everyone is ready');nextRound(g,0,now);label='Game started';break;
      case'openQuestion':assert(g.status==='playing'&&!g.paused,'Start or resume the game first');assert(!c,'Close the current question first');open(g,text(data.questionId),now,text(data.playerId)||null);label=`Question opened · ${currentQuestion(g)?.value}`;break;
      case'selectQuestion':assert(g.settings.selection==='winner'&&g.chooserId===playerId,'The host selects the question');assert(g.status==='playing'&&!g.paused&&!c,'Wait for the board');open(g,text(data.questionId),now,playerId);label=`${self!.name} selected a question`;break;
      case'closeQuestion':assert(c,'No active question');if(!g.played.includes(c!.questionId))g.played.push(c!.questionId);g.current=null;label='Question closed';break;
      case'openBuzzers':assert(c&&!c.revealed&&!c.revealAt&&c.phase==='question'&&!c.closed&&!g.paused,'No active question');c!.buzzOpen=true;c!.answeringId=null;c!.buzzes=[];label='Buzzers opened';break;
      case'closeBuzzers':assert(c,'No question');c!.buzzOpen=false;label='Buzzers closed';break;
      case'resetBuzzers':assert(c&&!c.revealed&&!c.revealAt&&!c.closed,'Question is closed');c!.buzzes=[];c!.answeringId=null;c!.attempted=[];c!.buzzOpen=true;label='Buzzers reset';break;
      case'answerer':assert(c&&!c.closed&&!c.revealAt,'No active question');assert(g.players.some(p=>p.id===data.playerId),'Choose a player');c!.answeringId=data.playerId;c!.buzzOpen=false;label='Answering player changed';break;
      case'judge':{
        assert(g.status==='playing'&&!g.paused&&c&&q&&!c.closed,'No active question');assert(c!.phase!=='wager','Finish wagering first');const p=g.players.find(p=>p.id===(data.playerId||c!.answeringId));assert(p,'Choose a player');const isFinal=g.rounds[g.roundIndex].type==='final',entry=c!.wagers[p!.id];if(isFinal)assert(entry&&!entry.judged,'This final answer has already been judged');else assert(!c!.attempted.includes(p!.id),'This player has already answered');
        const amount=isFinal||q!.dailyDouble?(entry?.wager||0):q!.value;const correct=!!data.correct;const delta=correct?amount*g.settings.correctMultiplier:g.settings.deductWrong||isFinal||q!.dailyDouble?-amount*g.settings.wrongMultiplier:0;
        setScore(g,p!,p!.score+delta,true);p!.stats[correct?'correct':'incorrect']++;if(isFinal){entry.judged=true;entry.correct=correct;}else{c!.attempted.push(p!.id);if(correct||q!.dailyDouble){c!.closed=true;g.chooserId=p!.id;reveal(g,now);}else{c!.answeringId=null;if(g.settings.lockWrong)c!.buzzes=c!.buzzes.filter(b=>b.playerId!==p!.id&&!c!.attempted.includes(b.playerId));else{c!.attempted=c!.attempted.filter(id=>id!==p!.id);c!.buzzes=[];}const queued=g.settings.buzzMode==='queue'?c!.buzzes.find(b=>!c!.attempted.includes(b.playerId)):null;if(queued)c!.answeringId=queued.playerId;c!.buzzOpen=g.settings.reopenWrong&&!queued;}}
        automatic(g,correct?'correct':'incorrect',p!.id,now);label=`${p!.name} · ${correct?'correct':'incorrect'}`;break;
      }
      case'reveal':reveal(g,now);label='Answer revealed';break;
      case'finalBegin':assert(c&&c.phase==='wager','No wagering round');if(q?.dailyDouble){assert(c!.answeringId&&c!.wagers[c!.answeringId],'Choose a player and collect their wager');c!.phase='question';c!.timer=timer(q.timer??g.settings.questionSeconds,g.settings.timerEnabled,now);}else{for(const p of g.players)if(!c!.wagers[p.id])c!.wagers[p.id]={wager:0,answer:'',submitted:true,judged:false};c!.phase='final';c!.timer=timer(g.settings.finalSeconds,g.settings.finalSeconds>0,now);}label='Wagers locked';break;
      case'hostWager':{assert(c&&c.phase==='wager','Wagers are closed');const p=g.players.find(p=>p.id===data.playerId);assert(p,'Choose a player');const max=g.settings.finalMaxWager==='unlimited'?1e7:Math.max(0,p!.score,q?.dailyDouble?q.value:0);c!.wagers[p!.id]={wager:Math.round(finite(data.wager,0,0,max)),answer:'',submitted:true,judged:false};if(q?.dailyDouble)c!.answeringId=p!.id;label=`${p!.name} · wager set`;break;}
      case'timerStart':assert(c,'No active question');c!.timer=timer(finite(data.seconds,q?.timer??g.settings.questionSeconds,0,3600),true,now);label='Timer started';break;
      case'timerPause':assert(c,'No active question');if(c!.timer.endsAt){c!.timer.remainingMs=Math.max(0,c!.timer.endsAt-now);c!.timer.endsAt=null;c!.timer.paused=true;}else if(c!.timer.remainingMs>0){c!.timer.endsAt=now+c!.timer.remainingMs;c!.timer.paused=false;}label='Timer updated';break;
      case'pause':g.paused=!g.paused;if(c){if(g.paused&&c.timer.endsAt){c.timer.remainingMs=Math.max(0,c.timer.endsAt-now);c.timer.endsAt=null;c.timer.paused=true;}else if(!g.paused&&c.timer.paused&&c.timer.remainingMs>0){c.timer.endsAt=now+c.timer.remainingMs;c.timer.paused=false;}}label=g.paused?'Game paused':'Game resumed';break;
      case'round':nextRound(g,Math.round(finite(data.index)),now);label=`Round · ${g.rounds[g.roundIndex].name}`;break;
      case'finish':g.status='finished';g.paused=false;if(c){c.buzzOpen=false;c.timer.endsAt=null;}label='Game finished';break;
      case'resume':g.status='playing';g.paused=false;label='Game resumed';break;
      case'adjust':{const p=g.players.find(p=>p.id===data.playerId);assert(p,'Player not found');setScore(g,p!,data.mode==='set'?finite(data.amount):p!.score+finite(data.amount));label=`${p!.name} · score adjusted`;break;}
      case'addPlayer':{const p=addPlayer(g,text(data.name));label=`${p.name} added`;break;}
      case'removePlayer':assert(g.players.some(p=>p.id===data.playerId),'Player not found');g.players=g.players.filter(p=>p.id!==data.playerId);if(c&&c.answeringId===data.playerId)c.answeringId=null;label='Player removed';break;
      case'renamePlayer':{const p=g.players.find(p=>p.id===data.playerId);assert(p,'Player not found');p!.name=text(data.name,32)||p!.name;label='Player renamed';break;}
      case'modifier':{assert(g.status==='playing'&&!g.paused,'Game is not running');const m=g.modifiers.find(m=>m.id===data.modifierId);assert(m&&m.trigger==='manual','Modifier not found');if(role==='player')assert(g.settings.participantModifiers&&m!.playerUsable,'This modifier is host-only');const actorId=role==='player'?playerId:text(data.actorId);applyModifier(g,m!,actorId,text(data.targetId)||null,now);label=`${m!.name} · ${g.players.find(p=>p.id===actorId)?.name}`;break;}
      default:throw new Error('Unknown action');
    }
    log(g,label,before);
  }catch(error){Object.assign(g,backup);throw error;}
}
export function tick(g:Game,now=Date.now()):boolean{
  if(!g.current||g.paused||g.status!=='playing')return false;let changed=false;const c=g.current;
  if(c.revealAt&&!c.revealed&&now>=c.revealAt){c.revealed=true;changed=true;}
  if(c.timer.endsAt&&now>=c.timer.endsAt){c.timer.endsAt=null;c.timer.remainingMs=0;c.timer.paused=false;if(c.phase==='final'||g.settings.expiryAction==='lock')c.buzzOpen=false;if(g.settings.expiryAction==='reveal'&&c.phase!=='wager'&&!c.revealAt)reveal(g,now);g.announcement={id:uid(),title:'Time is up',detail:'',at:now};changed=true;}
  if(changed)g.revision++;return changed;
}
export function view(g:Game,role:GameView['role'],playerId?:string,now=Date.now()):GameView{
  const{hostToken,undo,players,...base}=g;const q=currentQuestion(g);const reveal=role==='host'||!!g.current?.revealed;
  const rounds=g.rounds.map(r=>({...r,categories:r.categories.map(c=>({...c,questions:c.questions.map(q=>role==='host'?clone(q):{...q,prompt:'',answer:'',notes:''})}))}));
  const cur=g.current?clone(g.current):null;if(cur&&role!=='host')cur.wagers=Object.fromEntries(Object.entries(cur.wagers).map(([id,e])=>[id,{wager:reveal?e.wager:0,answer:reveal?e.answer:'',submitted:e.submitted,judged:e.judged,correct:reveal?e.correct:undefined}]));
  let cq=q?clone(q):null;if(cq&&role!=='host'){if(!reveal)cq.answer='';cq.notes='';if(cur?.phase==='wager')cq.prompt='';}
  return{...clone(base),filledQuestionIds:g.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions.filter(q=>q.prompt.trim()).map(q=>q.id))),settings:{...g.settings,joinPin:role==='host'?g.settings.joinPin:g.settings.joinPin?'required':''},rounds,players:players.map(({token,...p})=>clone(p)),current:cur,role,serverTime:now,selfId:playerId,currentQuestion:cq,yourFinal:playerId&&g.current?.wagers[playerId]?clone(g.current.wagers[playerId]):null};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {act,addPlayer,createGame,tick,updateDefinition,view} from '../server/engine.ts';
import {demoRounds,emptyQuestion,emptyRound,nextBoardValue} from '../shared/model.ts';
function fixture(){const g=createGame({name:'Test',definition:{rounds:demoRounds()}});const a=addPlayer(g,'Ada'),b=addPlayer(g,'Bea'),c=addPlayer(g,'Cam');act(g,'start');return{g,a,b,c,q:g.rounds[0].categories[0].questions[0]};}
test('joining an existing name reuses the group without resetting its state',()=>{
 const {g,a}=fixture();
 a.score=500;a.ready=true;a.blockedUntil=12345;a.stats.incorrect=1;
 const revision=g.revision;
 assert.equal(addPlayer(g,'  ADA  '),a);assert.equal(g.players.length,3);assert.equal(g.revision,revision);
 assert.equal(a.name,'Ada');assert.equal(a.score,500);assert(a.ready);assert.equal(a.blockedUntil,12345);assert.equal(a.stats.incorrect,1);
 act(g,'finish');assert.throws(()=>addPlayer(g,'Ada'),/ended/);
});
test('new games default to queued buzzes while explicit first-buzz settings are preserved',()=>{
 const {g,a,b,q}=fixture();assert.equal(g.settings.buzzMode,'queue');
 act(g,'openQuestion',{questionId:q.id});act(g,'openBuzzers');
 act(g,'buzz',{},'player',a.id);act(g,'buzz',{},'player',b.id);
 assert.deepEqual(g.current?.buzzes.map(buzz=>buzz.playerId),[a.id,b.id]);
 assert.equal(createGame({definition:{settings:{buzzMode:'first'}}}).settings.buzzMode,'first');
 assert.equal(createGame({definition:{settings:{buzzMode:'invalid'}}}).settings.buzzMode,'queue');
});
test('public snapshots never contain future answers, private notes or player tokens',()=>{const{g,a,q}=fixture();q.notes='secret-host-notes';act(g,'openQuestion',{questionId:q.id});for(const role of ['stage','player']as const){const v=view(g,role,a.id);const json=JSON.stringify(v);assert(!json.includes(q.answer));assert(!json.includes('secret-host-notes'));assert(!('hostToken' in v));assert(!json.includes(a.token));assert.equal(v.rounds[0].categories[1].questions[0].prompt,'');assert.equal(v.currentQuestion?.prompt,q.prompt);}assert.equal(view(g,'host').currentQuestion?.answer,q.answer);});
test('players can always join running and paused games, including old definitions that disabled late joining',()=>{
 const g=createGame({definition:{rounds:demoRounds(),settings:{allowLateJoin:false}}});
 assert(!('allowLateJoin' in g.settings));
 act(g,'start');assert.equal(addPlayer(g,'Late player').name,'Late player');
 act(g,'pause');assert.equal(addPlayer(g,'Paused player').name,'Paused player');
 act(g,'finish');assert.throws(()=>addPlayer(g,'After the end'),/ended/);
});
test('answer reveal is withheld until the configured server-side deadline',()=>{const{g,q}=fixture();act(g,'openQuestion',{questionId:q.id},'host',null,1000);act(g,'reveal',{},'host',null,1100);assert.equal(view(g,'stage',undefined,1500).currentQuestion?.answer,'');tick(g,2001);assert.equal(view(g,'stage').currentQuestion?.answer,q.answer);});
test('answer choices preserve the selected answer while public views hide correctness and future options',()=>{
 const rounds=demoRounds();Object.assign(rounds[0].categories[0].questions[0],{answer:'Old answer',answerOptions:['Mercury','Venus','Mars'],correctAnswerIndex:1,shuffleAnswers:false});
 const g=createGame({definition:{rounds,settings:{revealDelayMs:0}}}),player=addPlayer(g,'Ada'),q=g.rounds[0].categories[0].questions[0];
 assert.equal(q.answer,'Venus');assert.equal(q.correctAnswerIndex,1);
 for(const role of ['stage','player']as const){const future=view(g,role).rounds[0].categories[0].questions[0];assert(!('answerOptions' in future));assert(!('correctAnswerIndex' in future));}
 act(g,'start');act(g,'openQuestion',{questionId:q.id});
 for(const role of ['stage','player']as const){const current=view(g,role,player.id).currentQuestion!;assert.deepEqual(current.answerOptions,['Mercury','Venus','Mars']);assert.equal(current.answer,'');assert(!('correctAnswerIndex' in current));}
 assert.equal(view(g,'host').currentQuestion?.answer,'Venus');assert.equal(view(g,'host').currentQuestion?.correctAnswerIndex,1);
 act(g,'reveal');assert.equal(view(g,'stage').currentQuestion?.answer,'Venus');assert(!('correctAnswerIndex' in view(g,'stage').currentQuestion!));
});
test('Daily Double choices stay hidden until wagering ends',()=>{
 const {g,a,b,q}=fixture();Object.assign(q,{dailyDouble:true,answerOptions:['First','Second'],correctAnswerIndex:1,answer:'Second',shuffleAnswers:false});
 act(g,'openQuestion',{questionId:q.id});act(g,'assignDailyDouble',{fromId:b.id,playerId:a.id});
 for(const role of ['stage','player']as const)assert(!('answerOptions' in view(g,role,a.id).currentQuestion!));
 act(g,'hostWager',{playerId:a.id,wager:50});act(g,'finalBegin');
 assert.deepEqual(view(g,'player',a.id).currentQuestion?.answerOptions,['First','Second']);assert(!('correctAnswerIndex' in view(g,'player',a.id).currentQuestion!));
});
test('answer shuffling defaults on, stays synchronized, preserves correctness, and can be disabled',t=>{
 const {g,a,q}=fixture();Object.assign(q,{answerOptions:['A','B','C','D'],correctAnswerIndex:2,answer:'C'});
 t.mock.method(Math,'random',()=>0);
 act(g,'openQuestion',{questionId:q.id});
 assert.deepEqual(g.current?.answerOrder,[1,2,3,0]);assert.deepEqual(q.answerOptions,['A','B','C','D']);
 for(const role of ['stage','player']as const){
  const state=view(g,role,a.id);assert.deepEqual(state.currentQuestion?.answerOptions,['B','C','D','A']);assert(!('answerOrder' in state.current!));assert(!('correctAnswerIndex' in state.currentQuestion!));
 }
 const host=view(g,'host');assert.equal(host.currentQuestion?.correctAnswerIndex,1);assert.equal(host.currentQuestion?.answer,'C');
 act(g,'pause');assert.deepEqual(view(g,'stage').currentQuestion?.answerOptions,['B','C','D','A']);act(g,'pause');
 act(g,'closeQuestion');const next=g.rounds[0].categories[0].questions[1];Object.assign(next,{answerOptions:['First','Second'],correctAnswerIndex:0,answer:'First',shuffleAnswers:false});
 act(g,'openQuestion',{questionId:next.id});assert.equal(g.current?.answerOrder,undefined);assert.deepEqual(view(g,'stage').currentQuestion?.answerOptions,['First','Second']);
});
test('answer option normalization keeps at least two rows and defaults shuffling on',()=>{
 for(const input of [[],['Only answer']]){
  const rounds=demoRounds();Object.assign(rounds[0].categories[0].questions[0],{answer:'Legacy answer',answerOptions:input});
  const g=createGame({definition:{rounds}}),q=g.rounds[0].categories[0].questions[0];
  assert.equal(q.answerOptions?.length,2);assert.equal(q.answerOptions?.[1],'');assert.equal(q.shuffleAnswers,true);
 }
});
test('Free Response discards proposed choices and keeps the expected answer private until reveal',()=>{
 const rounds=demoRounds();Object.assign(rounds[0].categories[0].questions[0],{responseType:'free',answer:'Expected response',answerOptions:['Old choice','Other choice'],correctAnswerIndex:1,shuffleAnswers:true});
 const g=createGame({definition:{rounds,settings:{revealDelayMs:0}}}),q=g.rounds[0].categories[0].questions[0],a=addPlayer(g,'Ada');
 assert.equal(q.responseType,'free');assert.equal(q.answer,'Expected response');assert(!('answerOptions' in q));assert(!('correctAnswerIndex' in q));assert(!('shuffleAnswers' in q));
 act(g,'start');act(g,'openQuestion',{questionId:q.id});assert(!g.current?.answerOrder);
 for(const role of ['stage','player']as const){const visible=view(g,role,a.id).currentQuestion!;assert.equal(visible.responseType,'free');assert.equal(visible.answer,'');assert(!visible.answerOptions);}
 assert.equal(view(g,'host').currentQuestion?.answer,'Expected response');act(g,'reveal');assert.equal(view(g,'stage').currentQuestion?.answer,'Expected response');
});
test('Final stays after boards and reordering preserves the selected round',()=>{
 const [first,second,final]=demoRounds();
 const g=createGame({definition:{rounds:[final,first,second]}});assert.deepEqual(g.rounds.map(r=>r.id),[first.id,second.id,final.id]);
 g.roundIndex=1;act(g,'save',{rounds:[final,second,first]});assert.deepEqual(g.rounds.map(r=>r.id),[second.id,first.id,final.id]);assert.equal(g.rounds[g.roundIndex].id,second.id);
});
test('Final Free Response accepts private submissions and never offers a modifier or choices',()=>{
 const rounds=demoRounds();Object.assign(rounds[2].categories[0].questions[0],{responseType:'free',answer:'The final answer',answerOptions:['Old','Choices'],modifier:{title:'Invalid',instructions:'Not allowed'},dailyDouble:true});
 const g=createGame({definition:{rounds}}),a=addPlayer(g,'Ada');a.score=500;
 const q=g.rounds[2].categories[0].questions[0];assert.equal(q.modifier,null);assert.equal(q.dailyDouble,false);assert.equal(q.answer,'The final answer');assert(!q.answerOptions);
 act(g,'start');act(g,'round',{index:2});act(g,'wager',{wager:200},'player',a.id);act(g,'finalBegin');
 assert.equal(g.current?.phase,'final');assert.equal(view(g,'player',a.id).currentQuestion?.responseType,'free');assert(!view(g,'player',a.id).currentQuestion?.answerOptions);
 act(g,'finalAnswer',{answer:'My final response'},'player',a.id);assert.equal(view(g,'host').current?.wagers[a.id].answer,'My final response');assert.equal(view(g,'stage').current?.wagers[a.id].answer,'');
});
test('answer option imports retain single answers, infer and clamp selection, and reject malformed lists atomically',()=>{
 const rounds=demoRounds(),q=rounds[0].categories[0].questions[0];
 const original=q.answer;const legacy=createGame({definition:{rounds}});assert.equal(legacy.rounds[0].categories[0].questions[0].answer,original);
 Object.assign(q,{answer:'Second',answerOptions:['First','Second']});
 const g=createGame({definition:{rounds}});assert.equal(g.rounds[0].categories[0].questions[0].correctAnswerIndex,1);
 Object.assign(q,{correctAnswerIndex:999});updateDefinition(g,{rounds});assert.equal(g.rounds[0].categories[0].questions[0].answer,'Second');
 Object.assign(q,{correctAnswerIndex:-1});updateDefinition(g,{rounds});assert.equal(g.rounds[0].categories[0].questions[0].answer,'First');
 const before=structuredClone(g);Object.assign(q,{answerOptions:'not a list'});
 assert.throws(()=>updateDefinition(g,{rounds,name:'Must not replace'}),/Answer options/);assert.deepEqual(g,before);
});
test('first buzz wins; a second player cannot steal the floor',()=>{const{g,a,b,q}=fixture();g.settings.buzzMode='first';act(g,'openQuestion',{questionId:q.id});act(g,'openBuzzers');act(g,'buzz',{},'player',a.id,1000);assert.throws(()=>act(g,'buzz',{},'player',b.id,1001));assert.equal(g.current?.answeringId,a.id);assert.equal(g.current?.buzzes.length,1);});
test('a wrong answer reopens the floor but locks out the player who missed',()=>{const{g,a,b,q}=fixture();act(g,'openQuestion',{questionId:q.id});act(g,'openBuzzers');act(g,'buzz',{},'player',a.id);act(g,'judge',{correct:false});assert.equal(a.score,-100);assert(g.current?.buzzOpen);assert.throws(()=>act(g,'buzz',{},'player',a.id));act(g,'buzz',{},'player',b.id);act(g,'judge',{correct:true});assert.equal(g.players.find(p=>p.id===b.id)?.score,100);assert(g.current?.closed);assert.throws(()=>act(g,'judge',{correct:true,playerId:b.id}));});
test('queue mode advances to the next buzz after a wrong answer',()=>{const{g,a,b,q}=fixture();g.settings.buzzMode='queue';act(g,'openQuestion',{questionId:q.id});act(g,'openBuzzers');act(g,'buzz',{},'player',a.id);act(g,'buzz',{},'player',b.id);act(g,'judge',{correct:false});assert.equal(g.current?.answeringId,b.id);});
test('early buzzing applies a temporary penalty without adding a buzz',()=>{const{g,a,q}=fixture();act(g,'openQuestion',{questionId:q.id});assert.throws(()=>act(g,'buzz',{},'player',a.id,1000));assert.equal(a.blockedUntil,1750);act(g,'openBuzzers');assert.throws(()=>act(g,'buzz',{},'player',a.id,1500));act(g,'buzz',{},'player',a.id,1800);assert.equal(g.current?.answeringId,a.id);});
test('questions remain open without time limits and game pause still blocks play',()=>{
 const {g,a,q}=fixture();g.settings.autoOpenBuzzers=true;
 act(g,'openQuestion',{questionId:q.id},'host',null,1000);
 assert(!('timer' in g.current!));assert(!tick(g,86400000));assert(g.current?.buzzOpen);assert(!g.current?.revealed);
 act(g,'pause');assert.throws(()=>act(g,'buzz',{},'player',a.id,86400001),/not running/);
 act(g,'pause');act(g,'buzz',{},'player',a.id,86400002);assert.equal(g.current?.answeringId,a.id);
});
test('private final wagers, private submissions, scoring exactly once and final results',()=>{const{g,a,b}=fixture();a.score=500;b.score=-100;act(g,'round',{index:2});act(g,'wager',{wager:800},'player',a.id);act(g,'wager',{wager:200},'player',b.id);assert.equal(g.current?.wagers[a.id].wager,500);assert.equal(g.current?.wagers[b.id].wager,0);assert.equal(view(g,'stage').current?.wagers[a.id].wager,0);act(g,'finalBegin');act(g,'finalAnswer',{answer:'A light-year'},'player',a.id);assert.equal(view(g,'stage').current?.wagers[a.id].answer,'');assert.equal(view(g,'host').current?.wagers[a.id].answer,'A light-year');act(g,'judge',{playerId:a.id,correct:true});assert.equal(a.score,1000);assert.throws(()=>act(g,'judge',{playerId:a.id,correct:true}));act(g,'finish');assert.equal(g.status,'finished');});
test('Daily Double presenter records the spoken wager and scores only the assigned team',()=>{const{g,a,b,q}=fixture();q.dailyDouble=true;a.score=500;act(g,'openQuestion',{questionId:q.id});act(g,'assignDailyDouble',{fromId:b.id,playerId:a.id});assert.equal(g.current?.phase,'wager');assert.throws(()=>act(g,'wager',{wager:100},'player',b.id));act(g,'hostWager',{playerId:a.id,wager:400});act(g,'finalBegin');act(g,'judge',{correct:true});assert.equal(a.score,900);});
test('malformed definitions cannot partially overwrite valid data',()=>{const{g}=fixture();const original=structuredClone(g.rounds);assert.throws(()=>updateDefinition(g,{rounds:[{name:'broken',categories:null}],name:'oops'}));assert.deepEqual(g.rounds,original);assert.equal(g.name,'Test');});
test('player permissions reject score changes, judging, settings and arbitrary actor impersonation',()=>{const{g,a,b}=fixture();for(const action of ['adjust','judge','save','round','finish','undo'])assert.throws(()=>act(g,action,{playerId:b.id,amount:9999},'player',a.id));assert.equal(b.score,0);});
test('old timer settings, question overrides and timer commands cannot enable countdowns',()=>{
 const rounds=demoRounds();Object.assign(rounds[0].categories[0].questions[0],{timer:1});
 const settings={timerEnabled:true,questionSeconds:1,answerSeconds:1,finalSeconds:1,autoStartTimer:true,expiryAction:'reveal'};
 const g=createGame({definition:{rounds,settings}});
 act(g,'save',{settings});for(const key of Object.keys(settings))assert(!(key in g.settings));
 const q=g.rounds[0].categories[0].questions[0];assert(!('timer' in q));
 act(g,'start');act(g,'openQuestion',{questionId:q.id});
 for(const action of ['timerStart','timerPause'])assert.throws(()=>act(g,action,{seconds:1}),/Unknown action/);
 assert(!('timer' in g.current!));assert(!tick(g,Date.now()+86400000));assert(!g.current?.revealed);
});

test('new games have no precreated categories or questions; empty drafts can be saved',()=>{
 const g=createGame({name:'Empty'});assert.equal(g.rounds.length,1);assert.equal(g.rounds[0].categories.length,0);
 const rounds=structuredClone(g.rounds);rounds[0].categories=[{id:'empty-category',name:'First',questions:[]}];
 act(g,'save',{rounds});assert.equal(g.rounds[0].categories[0].questions.length,0);
 act(g,'save',{rounds:[{...g.rounds[0],categories:[]}]});assert.equal(g.rounds[0].categories.length,0);
});
test('category values progress independently with round-specific defaults and uneven boards survive export/import',()=>{
 const rounds=[0,1,2].map(roundIndex=>{
  const round=emptyRound(roundIndex+1);
  round.categories=[{id:`long-${roundIndex}`,name:'Long',questions:[]},{id:`short-${roundIndex}`,name:'Short',questions:[]},{id:`empty-${roundIndex}`,name:'Empty',questions:[]}];
  for(const [categoryIndex,count]of [4,1,0].entries())for(let i=0;i<count;i++){
   const category=round.categories[categoryIndex];
   category.questions.push({...emptyQuestion(nextBoardValue(category.questions,roundIndex)),prompt:`Question ${i}`,answer:'Answer'});
  }
  assert.deepEqual(round.categories[0].questions.map(q=>q.value),[1,2,3,4].map(n=>n*(roundIndex+1)*100));
  assert.deepEqual(round.categories[1].questions.map(q=>q.value),[(roundIndex+1)*100]);
  return round;
 });
 // Removing a middle question keeps the others' values and the next addition unique.
 rounds[0].categories[0].questions.splice(1,1);
 assert.equal(nextBoardValue(rounds[0].categories[0].questions,0),500);
 const g=createGame({definition:{rounds}});
 const imported=createGame({definition:JSON.parse(JSON.stringify({rounds:g.rounds}))});
 assert.deepEqual(imported.rounds,rounds);
 for(const role of ['host','stage','player']as const)assert.deepEqual(view(imported,role).rounds.map(r=>r.categories.map(c=>c.questions.length)),[[3,1,0],[4,1,0],[4,1,0]]);
 addPlayer(imported,'Ada');act(imported,'start');act(imported,'round',{index:2});
 const question=imported.rounds[2].categories[1].questions[0];
 act(imported,'openQuestion',{questionId:question.id});act(imported,'answerer',{playerId:imported.players[0].id});act(imported,'judge',{correct:true});
 assert.equal(imported.players[0].score,300);
});
test('blank and whitespace-only questions cannot be selected in a game',()=>{
 const {g,q}=fixture();q.prompt='   ';assert.throws(()=>act(g,'openQuestion',{questionId:q.id}),/empty/);assert.equal(g.current,null);
});
test('an empty final round can be edited and started without attempting to open a missing question',()=>{
 const g=createGame();g.rounds[0].type='final';assert.doesNotThrow(()=>act(g,'start'));assert.equal(g.current,null);
});
test('public boards distinguish playable questions from blanks without disclosing question text',()=>{
 const {g,q}=fixture();q.prompt='   ';const filled=g.rounds[0].categories[0].questions[1];
 for(const role of ['stage','player']as const){const publicView=view(g,role);assert(!publicView.filledQuestionIds.includes(q.id));assert(publicView.filledQuestionIds.includes(filled.id));assert.equal(publicView.rounds[0].categories[0].questions[1].prompt,'');}
});

test('hidden modifiers look like normal cells and reveal their instructions only after being claimed',()=>{
 const {g,a,b,q}=fixture();q.prompt='';q.answer='';q.modifier={title:'Trading places',instructions:'Swap all points with another team.'};
 g.settings.buzzMode='queue';a.score=300;b.score=700;
 for(const role of ['stage','player']as const){const v=view(g,role,a.id);assert(v.filledQuestionIds.includes(q.id));assert.equal(v.rounds[0].categories[0].questions[0].modifier,null);assert(!JSON.stringify(v).includes('Trading places'));}
 act(g,'openQuestion',{questionId:q.id},'host',null,1000);
 assert.equal(g.current?.phase,'modifier');assert.equal(g.current?.buzzOpen,true);assert(!('timer' in g.current!));
 assert.throws(()=>act(g,'reveal',{},'host',null,1001),/claim/);
 for(const role of ['stage','player']as const)assert(!JSON.stringify(view(g,role,a.id)).includes(q.modifier.instructions));
 act(g,'buzz',{},'player',b.id,1100);
 assert.throws(()=>act(g,'buzz',{},'player',a.id,1101),/claimed/);
 assert.equal(g.current?.answeringId,b.id);assert.equal(g.modifierClaims.length,1);
 assert.equal(a.score,300);assert.equal(b.score,700);assert.equal(b.stats.correct,0);
 for(const role of ['stage','player']as const){const v=view(g,role,b.id,1500);assert.equal(v.modifierClaims.length,0);assert.equal(v.currentQuestion?.modifier,null);assert(!JSON.stringify(v).includes(q.modifier.instructions));}
 tick(g,2001);
 for(const role of ['stage','player']as const){const v=view(g,role,b.id,2001);assert.equal(v.currentQuestion?.modifier?.instructions,q.modifier.instructions);assert.equal(v.modifierClaims[0].playerId,b.id);assert.equal(v.rounds[0].categories[0].questions[0].modifier,null);}
 assert.throws(()=>act(g,'judge',{correct:true}),/manually/);
});
test('claiming a modifier can be undone and never consumes answer or score rules',()=>{
 const {g,a,b,q}=fixture();q.modifier={title:'Sign flip',instructions:'Multiply your points by -1.'};
 act(g,'openQuestion',{questionId:q.id});act(g,'buzz',{},'player',a.id);
 act(g,'undo');assert.equal(g.modifierClaims.length,0);assert.equal(g.current?.answeringId,null);assert.equal(g.current?.buzzOpen,true);
 act(g,'buzz',{},'player',b.id);assert.equal(g.modifierClaims[0].playerId,b.id);
});
test('modifier reminders survive the board and round changes until manually dismissed',()=>{
 const {g,a,q}=fixture();q.modifier={title:'Close enough',instructions:'Approximate answers allowed for 3 rounds.'};g.settings.revealDelayMs=0;
 act(g,'openQuestion',{questionId:q.id});act(g,'buzz',{},'player',a.id);act(g,'closeQuestion');act(g,'round',{index:1});
 assert.equal(view(g,'player',a.id).modifierClaims[0].instructions,q.modifier.instructions);
 assert.throws(()=>act(g,'dismissModifier',{id:g.modifierClaims[0].id},'player',a.id),/Host/);
 act(g,'dismissModifier',{id:g.modifierClaims[0].id});assert.equal(g.modifierClaims.length,0);
 act(g,'undo');assert.equal(g.modifierClaims.length,1);
});
test('hidden modifier definitions validate, export cleanly, and exclude daily doubles and finals',()=>{
 const rounds=demoRounds(),q=rounds[0].categories[0].questions[0];q.prompt='';q.dailyDouble=true;q.modifier={title:'Hidden',instructions:'Steal 100 points.'};
 rounds[2].categories[0].questions[0].modifier={title:'Invalid final',instructions:'Not supported.'};
 const g=createGame({definition:{rounds,modifiers:[{trigger:'roundStart',effects:[{type:'set',amount:999999}]}]}});
 assert.equal(g.rounds[0].categories[0].questions[0].dailyDouble,false);assert.equal(g.rounds[2].categories[0].questions[0].modifier,null);
 const p=addPlayer(g,'Ada');act(g,'start');assert.equal(p.score,0);assert.throws(()=>act(g,'modifier',{modifierId:'legacy'}),/Unknown action/);
 const imported=createGame({definition:JSON.parse(JSON.stringify({rounds:g.rounds}))});assert.deepEqual(imported.rounds,g.rounds);
});
test('empty modifier instructions are unplayable even when the old question still has text',()=>{
 const {g,q}=fixture();q.modifier={title:'Draft',instructions:'   '};
 assert.throws(()=>act(g,'openQuestion',{questionId:q.id}),/empty/);assert(!view(g,'stage').filledQuestionIds.includes(q.id));
});
test('only the presenter selects questions, including after correct answers and modifier claims',()=>{
 const g=createGame({definition:{rounds:demoRounds(),settings:{selection:'winner'}}});
 const a=addPlayer(g,'Ada'),b=addPlayer(g,'Bea');
 const q=g.rounds[0].categories[0].questions[0];
 act(g,'save',{settings:{selection:'winner'}});assert(!('selection' in g.settings));act(g,'start');
 for(const p of [a,b])for(const action of ['selectQuestion','openQuestion','chooser'])assert.throws(()=>act(g,action,{questionId:q.id,playerId:p.id},'player',p.id),/Host access/);
 assert.throws(()=>act(g,'chooser',{playerId:a.id}),/Unknown action/);
 act(g,'openQuestion',{questionId:q.id});act(g,'openBuzzers');act(g,'buzz',{},'player',a.id);act(g,'judge',{correct:true});act(g,'closeQuestion');
 const mystery=g.rounds[0].categories[0].questions[1];mystery.modifier={title:'Surprise',instructions:'Apply manually.'};
 assert.throws(()=>act(g,'selectQuestion',{questionId:mystery.id},'player',a.id),/Host access/);
 act(g,'openQuestion',{questionId:mystery.id});act(g,'buzz',{},'player',b.id);act(g,'closeQuestion');
 assert.throws(()=>act(g,'selectQuestion',{questionId:q.id},'player',b.id),/Host access/);
 assert(!('chooserId' in g));
});
test('queued answerers retain the floor until the presenter judges them',()=>{
 const {g,a,b,q}=fixture();g.settings.buzzMode='queue';
 act(g,'openQuestion',{questionId:q.id},'host',null,1000);act(g,'openBuzzers');
 act(g,'buzz',{},'player',a.id,2000);act(g,'buzz',{},'player',b.id,3000);
 assert(!tick(g,86400000));assert.equal(g.current?.answeringId,a.id);
 act(g,'judge',{correct:false},'host',null,86400001);
 assert.equal(g.current?.answeringId,b.id);assert(!('timer' in g.current!));
 assert(!tick(g,172800000));assert.equal(g.current?.answeringId,b.id);
 act(g,'judge',{correct:true},'host',null,172800001);assert.equal(b.score,100);
});
test('final answers remain editable until the presenter reveals the answer',()=>{
 const {g,a}=fixture();act(g,'round',{index:2},'host',null,1000);act(g,'finalBegin',{},'host',null,2000);
 assert(!('timer' in g.current!));assert(!tick(g,86400000));
 act(g,'finalAnswer',{answer:'First answer'},'player',a.id,86400001);
 act(g,'finalAnswer',{answer:'Edited answer'},'player',a.id,172800000);
 assert.equal(g.current?.wagers[a.id].answer,'Edited answer');
 act(g,'reveal',{},'host',null,172800001);
 assert.throws(()=>act(g,'finalAnswer',{answer:'After reveal'},'player',a.id,172800002),/Answers are closed/);
 tick(g,172801000);assert(g.current?.revealed);
 assert.throws(()=>act(g,'finalAnswer',{answer:'After reveal'},'player',a.id,172801001),/Answers are closed/);
});
test('Daily Double answerers have no deadline',()=>{
 const {g,a,b,q}=fixture();q.dailyDouble=true;
 act(g,'openQuestion',{questionId:q.id},'host',null,1000);act(g,'assignDailyDouble',{fromId:b.id,playerId:a.id},'host',null,1100);
 act(g,'hostWager',{playerId:a.id,wager:100},'host',null,2000);act(g,'finalBegin',{},'host',null,3000);
 assert(!tick(g,86400000));assert(!g.current?.revealed);assert(!('timer' in g.current!));
 act(g,'judge',{correct:true},'host',null,86400001);assert.equal(a.score,100);
});

test('an active cell cannot switch between a question and a hidden modifier',()=>{
 const {g,q}=fixture();act(g,'openQuestion',{questionId:q.id});
 const rounds=structuredClone(g.rounds);rounds[0].categories[0].questions[0].modifier={title:'Secret',instructions:'Hidden effect'};
 assert.throws(()=>updateDefinition(g,{rounds}),/question type/);assert.equal(g.current?.phase,'question');assert.equal(g.rounds[0].categories[0].questions[0].modifier,null);
});

test('host reset clears the session in every game state and preserves the complete board and room',()=>{
 for(const status of ['lobby','playing','paused','finished']){
  const {g,a,q}=fixture();
  q.notes='Keep host notes';q.dailyDouble=true;
  const modifier=g.rounds[1].categories[0].questions[0];modifier.modifier={title:'Keep this modifier',instructions:'Swap scores manually.'};
  g.subtitle='Keep subtitle';g.theme.title='Keep this screen';
  a.score=900;a.ready=true;a.connected=true;a.stats.correct=3;
  g.played=[q.id];g.questionCount=7;g.modifierClaims=[{id:'claim',questionId:modifier.id,playerId:a.id,roundIndex:1,...modifier.modifier}];
  act(g,'round',{index:2});act(g,'finalBegin');act(g,'finalAnswer',{answer:'Old answer'},'player',a.id);
  g.announcement={id:'old',title:'Old announcement',detail:'Old progress',at:1};
  if(status==='lobby')g.status='lobby';
  if(status==='paused')act(g,'pause');
  if(status==='finished')act(g,'finish');
  const definition=structuredClone({id:g.id,createdAt:g.createdAt,name:g.name,subtitle:g.subtitle,rounds:g.rounds,settings:g.settings,theme:g.theme});
  const revision=g.revision;
  act(g,'reset');
  assert.deepEqual({id:g.id,createdAt:g.createdAt,name:g.name,subtitle:g.subtitle,rounds:g.rounds,settings:g.settings,theme:g.theme},definition);
  assert.equal(g.status,'lobby');assert.equal(g.roundIndex,0);assert.equal(g.paused,false);assert.equal(g.current,null);assert.equal(g.questionCount,0);assert.equal(g.announcement,null);assert.equal(g.revision,revision+1);
  for(const key of ['players','played','modifierClaims','history','undo']as const)assert.deepEqual(g[key],[]);
  assert(!JSON.stringify(g).includes(a.token));assert(!JSON.stringify(g).includes('Old answer'));
  assert.throws(()=>act(g,'undo'),/Nothing to undo/);
  const fresh=addPlayer(g,a.name);assert.notEqual(fresh.id,a.id);assert.notEqual(fresh.token,a.token);assert.equal(fresh.score,0);assert.equal(fresh.ready,false);assert.deepEqual(fresh.stats,{correct:0,incorrect:0,buzzes:0});
  act(g,'start');act(g,'openQuestion',{questionId:q.id,playerId:fresh.id});const reopened=view(g,'host').current;assert.equal(reopened?.questionId,q.id);assert.equal(reopened?.phase,'wager');
 }
});
test('players cannot reset the game or clear another player’s progress',()=>{
 const {g,a,b,q}=fixture();act(g,'openQuestion',{questionId:q.id});act(g,'adjust',{playerId:b.id,amount:500});
 const before=structuredClone(g);
 assert.throws(()=>act(g,'reset',{},'player',a.id),/Host access required/);assert.deepEqual(g,before);
});

test('prepare before play: game definitions lock on start, stay locked when paused or finished, and unlock after reset',()=>{
 const g=createGame({name:'Prepared game',definition:{rounds:demoRounds()}});
 const rounds=structuredClone(g.rounds);rounds[0].categories[0].questions[0].prompt='Prepared clue';
 act(g,'save',{rounds,name:'Ready to host',settings:{startingScore:0},theme:{title:'Prepared appearance'}});
 assert.equal(g.name,'Ready to host');assert.equal(g.rounds[0].categories[0].questions[0].prompt,'Prepared clue');assert.equal(g.theme.title,'Prepared appearance');
 act(g,'start');
 for(const state of ['playing','paused','finished']){
  if(state==='paused')act(g,'pause');
  if(state==='finished')act(g,'finish');
  const before=structuredClone(g);
  for(const data of [{rounds:demoRounds()},{name:'Late rename'},{settings:{startingScore:999}},{theme:{title:'Late appearance'}}]){
   assert.throws(()=>act(g,'save',data),/Make a copy to edit/);assert.deepEqual(g,before);
  }
 }
 act(g,'reset');act(g,'save',{name:'Prepared for next time'});assert.equal(g.name,'Prepared for next time');
});

test('selection cue exposes only the chosen cell before normal questions, Daily Doubles and modifiers open',()=>{
 for(const kind of ['question','dailyDouble','modifier']){
  const {g,a,q}=fixture();g.settings.autoOpenBuzzers=true;
  if(kind==='dailyDouble')q.dailyDouble=true;
  if(kind==='modifier'){q.prompt='';q.modifier={title:'Secret modifier',instructions:'Secret instructions'};}
  act(g,'selectQuestion',{questionId:q.id},'host',null,1000);
  assert.equal(g.current,null);assert.equal(g.selection?.questionId,q.id);assert.equal(g.questionCount,0);
  for(const role of ['stage','player']as const){const snapshot=view(g,role,a.id);assert.equal(snapshot.selection?.questionId,q.id);assert.equal(snapshot.currentQuestion,null);assert(!JSON.stringify(snapshot).includes(q.answer));if(q.modifier)assert(!JSON.stringify(snapshot).includes(q.modifier.instructions));}
  assert.throws(()=>act(g,'buzz',{},'player',a.id,1100));assert.equal(a.blockedUntil,0);
  assert.throws(()=>act(g,'selectQuestion',{questionId:g.rounds[0].categories[0].questions[1].id},'host',null,1100),/already selected/);
  assert.throws(()=>act(g,'openQuestion',{questionId:q.id},'host',null,1100));
  assert(!tick(g,1799));assert.equal(g.current,null);assert(tick(g,1800));
  const active=view(g,'host').current;assert.equal(g.selection,null);assert.equal(active?.questionId,q.id);assert.equal(g.questionCount,1);
  assert.equal(active?.phase,kind==='modifier'?'modifier':kind==='dailyDouble'?'wager':'question');assert.equal(active?.buzzOpen,kind!=='dailyDouble');
 }
});
test('undo, reset, finish and round changes cancel pending question selections',()=>{
 for(const action of ['undo','reset','finish','round']){
  const {g,q}=fixture();act(g,'selectQuestion',{questionId:q.id},'host',null,1000);
  act(g,action,action==='round'?{index:1}:{},'host',null,1200);
  assert.equal(g.selection,null);assert.equal(g.current,null);assert(!tick(g,5000));assert.equal(g.current,null);assert.equal(g.questionCount,0);
 }
});
test('paused selections wait for resume and invalid or played questions cannot be selected',()=>{
 const {g,q}=fixture();act(g,'selectQuestion',{questionId:q.id},'host',null,1000);act(g,'pause');
 assert(!tick(g,5000));assert.equal(g.current,null);act(g,'pause');assert(tick(g,5001));assert.equal(view(g,'host').current?.questionId,q.id);
 act(g,'closeQuestion');assert.throws(()=>act(g,'selectQuestion',{questionId:q.id}),/already been played/);
 const blank=g.rounds[0].categories[0].questions[1];blank.prompt=' ';
 assert.throws(()=>act(g,'selectQuestion',{questionId:blank.id}),/empty/);assert.throws(()=>act(g,'selectQuestion',{questionId:'missing'}),/not found/);assert.equal(g.selection,null);
});

test('retired phone display options cannot hide scores or restore question screens',()=>{
 const g=createGame({definition:{rounds:demoRounds(),settings:{showQuestionOnPhone:true,showScoresOnPhone:false}}});
 assert(!('showQuestionOnPhone' in g.settings));assert(!('showScoresOnPhone' in g.settings));
 // Previously saved options are also omitted from published settings.
 Object.assign(g.settings,{showQuestionOnPhone:true,showScoresOnPhone:false});
 for(const role of ['host','player','stage']as const){const settings=view(g,role).settings;assert(!('showQuestionOnPhone' in settings));assert(!('showScoresOnPhone' in settings));}
 updateDefinition(g,{settings:{showQuestionOnPhone:true,showScoresOnPhone:false}});
 assert(!('showQuestionOnPhone' in g.settings));assert(!('showScoresOnPhone' in g.settings));
});

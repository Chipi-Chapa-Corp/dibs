import type {Current,GameView,PublicPlayer,Question} from '../shared/model';
import {isQuestionFilled} from '../shared/model';
import {FINAL_ANSWER_MS,resultGroups,resultRevealAt} from './final-results';

export interface AppearancePreview { id:string; title:string; game:GameView; time:number }
const exampleTeams:PublicPlayer[]=['Red','Blue','Green'].map((name,i)=>({id:`preview-team-${i}`,name,color:['#b7482d','#557c9b','#6a8359'][i],score:[1000,700,400][i],connected:true,ready:true,blockedUntil:0,stats:{correct:0,incorrect:0,buzzes:0},joinedAt:i}));

/** Real presenter states, using this game's clues and the real display renderer. */
export function appearancePreviews(game:GameView,roundId:string|null):AppearancePreview[]{
  const time=Date.now(),players=game.players.length?game.players:exampleTeams;
  const base:GameView={...game,role:'stage',players,members:[],selfId:undefined,selfMemberId:undefined,editLock:null,canUndo:false,
    current:null,currentQuestion:null,yourFinal:null,status:'playing',paused:false,played:[],selection:null,announcement:null,history:[],resultsSkipped:false,serverTime:time,
    rounds:game.rounds.map(r=>({...r,categories:r.categories.map(c=>({...c,questions:c.questions.map(q=>({...q,prompt:'',answer:'',notes:'',answerOptions:undefined,correctAnswerIndex:undefined,modifier:null}))}))})),
    filledQuestionIds:game.rounds.flatMap(r=>r.categories.flatMap(c=>c.questions.filter(isQuestionFilled).map(q=>q.id)))};
  const scenes:AppearancePreview[]=[];
  const add=(id:string,title:string,changes:Partial<GameView>)=>scenes.push({id,title,game:{...base,...changes},time});
  if(!roundId)add('lobby','Before the game',{status:'lobby',roundIndex:0});
  for(const [roundIndex,round]of game.rounds.entries()){
    if(roundId&&round.id!==roundId)continue;
    const entries=round.categories.flatMap(c=>c.questions.filter(isQuestionFilled).map(q=>({q,category:c.name})));
    const regular=entries.filter(({q})=>!q.modifier&&!q.dailyDouble);
    const fallback:Question={id:'preview-clue',value:100,prompt:'Your question appears here.',answer:'Your answer appears here.',notes:'',dailyDouble:false};
    const selected=regular[0]||{q:fallback,category:round.categories[0]?.name||'Category'};
    const build=(q:Question,category:string,phase:Current['phase']='question'):GameView=>({...base,roundIndex,currentQuestion:{...q,notes:'',answer:'',correctAnswerIndex:undefined},
      current:{questionId:q.id,category,openedAt:time-6000,buzzOpen:phase==='question'&&!q.dailyDouble,buzzes:[],answeringId:null,attempted:[],revealAt:null,revealed:false,phase,wagers:{},closed:false}});
    const put=(key:string,label:string,state:GameView)=>add(`${round.id}:${key}`,`${round.name} · ${label}`,state);
    const results=(q?:Question)=>{
      const final=round.type==='final',offset=final?FINAL_ANSWER_MS:0;
      const finished:GameView={...base,roundIndex,status:'finished',currentQuestion:q?{...q,notes:''}:null};
      if(final&&q)finished.current={questionId:q.id,category:selected.category,phase:'final',openedAt:time-60000,buzzOpen:false,buzzes:[],answeringId:null,attempted:[],revealAt:time-6000,revealed:true,closed:true,answersLocked:true,
        wagers:Object.fromEntries(players.map((p,i)=>[p.id,{wager:200,answer:i===0?q.answer:'Sample answer',submitted:true,answerSubmitted:true,judged:true,correct:i===0}]))};
      const groups=resultGroups(players);
      const scene=(key:string,label:string,elapsed:number)=>put(key,label,{...finished,history:[{id:'preview-finish',at:time-elapsed,label:'Game finished',deltas:{}}]});
      if(final&&q?.answer)scene('final-answer','Final answer',1000);
      scene('countdown','Results countdown',offset+500);
      if(groups.length>1)scene('places','Results · places',offset+resultRevealAt(0,groups.length)+100);
      scene('winner','Winner',100000);
    };
    if(round.type==='board'){
      put('board','Board',{...base,roundIndex});
      put('selection','Question selection',{...base,roundIndex,selection:{questionId:selected.q.id,opensAt:time+800}});
      const variants:[string,string,typeof selected|undefined][]=[
        ['question','Question',regular.find(({q})=>!q.answerOptions?.length&&!/!\[|<img\b|\.(mp3|wav|ogg|m4a|mp4|webm)\b/i.test(q.prompt))||{q:fallback,category:selected.category}],
        ['picture','Picture clue',regular.find(({q})=>/!\[|<img\b/i.test(q.prompt))],
        ['audio','Audio clue',regular.find(({q})=>/<audio\b|\.(mp3|wav|ogg|m4a)\b/i.test(q.prompt))],
        ['video','Video clue',regular.find(({q})=>/<video\b|\.(mp4|webm|ogv)\b|youtu/i.test(q.prompt))],
        ['choices','Answer choices',regular.find(({q})=>q.answerOptions&&q.answerOptions.length>1)],
      ];
      for(const [key,label,entry]of variants)if(entry)put(key,label,build(entry.q,entry.category));
      const clue=build(selected.q,selected.category);
      put('buzz','Buzz received',{...clue,current:{...clue.current!,answeringId:players[0].id,buzzOpen:false,buzzes:[{playerId:players[0].id,at:time,order:1}]}});
      put('incorrect','Incorrect answer',{...clue,current:{...clue.current!,attempted:[players[0].id],incorrectTeamIds:[players[0].id]}});
      put('answer-reveal','Answer reveal',{...clue,current:{...clue.current!,closed:true,buzzOpen:false,revealAt:time+900}});
      put('answer','Answer revealed',{...clue,currentQuestion:{...selected.q,notes:''},current:{...clue.current!,answeringId:players[0].id,buzzOpen:false,closed:true,revealed:true,revealAt:time-1000}});
      const slow=regular.find(({q})=>q.slowReveal);
      if(slow){const state=build(slow.q,slow.category);put('image-reveal','Image reveal',{...state,current:{...state.current!,openedAt:time-2500,imageRevealPausedAt:time,answeringId:players[0].id,buzzOpen:false}});}
      const double=entries.find(({q})=>q.dailyDouble);
      if(double){
        const state=build(double.q,double.category,'wager');
        state.current={...state.current!,buzzOpen:false,dailyDoubleFromId:players[1]?.id||players[0].id,answeringId:players[0].id,wagers:{[players[0].id]:{wager:500,answer:'',submitted:true,judged:false}}};
        put('double','Daily Double',state);
        put('double-question','Daily Double question',{...state,current:{...state.current,phase:'question'}});
      }
      const modifier=entries.find(({q})=>q.modifier);
      if(modifier){
        const state=build(modifier.q,modifier.category,'modifier');state.current!.buzzOpen=true;state.currentQuestion={...modifier.q,prompt:'',answer:'',modifier:null,notes:''};
        put('modifier','Mystery modifier',state);
        put('modifier-claimed','Claimed modifier',{...state,currentQuestion:{...modifier.q,notes:''},current:{...state.current!,answeringId:players[0].id,closed:true,revealed:true,revealAt:time-1000,buzzOpen:false}});
      }
      put('paused','Paused',{...clue,paused:true});
      results();
    }else{
      if(round.categories.length>1){
        put('categories','Final categories',{...base,roundIndex,finalCategorySelection:{roundId:round.id,rejectedCategoryIds:[]}});
        put('category-chosen','Final category chosen',{...base,roundIndex,finalCategorySelection:{roundId:round.id,rejectedCategoryIds:round.categories.slice(1).map(c=>c.id)}});
      }
      const state=build(selected.q,selected.category,'wager');
      state.current!.wagers=Object.fromEntries(players.map((p,i)=>[p.id,{wager:200,answer:'',submitted:i===0,answerSubmitted:false,judged:false}]));
      put('wagers','Final wagers',state);
      const question={...state,current:{...state.current!,phase:'final' as const}};
      put('final-question','Final question',question);
      put('answers-locked','Answers locked',{...question,current:{...question.current,answersLocked:true}});
      put('paused','Paused',{...question,paused:true});results(selected.q);
    }
  }
  return scenes;
}

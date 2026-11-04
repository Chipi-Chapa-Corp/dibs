import type {PublicPlayer} from '../shared/model';

export const RESULTS_COUNTDOWN_MS=3000;
export const FINAL_ANSWER_MS=5000;
const PLACE_MS=1700,WINNER_PAUSE_MS=900;

export function resultGroups(teams:PublicPlayer[]){
  const scores=[...new Set(teams.map(team=>team.score))].sort((a,b)=>a-b);
  return scores.map(score=>({score,rank:1+teams.filter(team=>team.score>score).length,teams:teams.filter(team=>team.score===score)}));
}
export function resultRevealAt(index:number,count:number){
  return RESULTS_COUNTDOWN_MS+index*PLACE_MS+(index===count-1&&count>1?WINNER_PAUSE_MS:0);
}
export function resultStep(elapsed:number,count:number){
  let step=-1;
  for(let index=0;index<count;index++)if(elapsed>=resultRevealAt(index,count))step=index;
  return step;
}

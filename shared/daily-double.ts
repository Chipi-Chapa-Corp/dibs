import type {Current} from './model';

export type DailyDoubleStep='chooser'|'opponent'|'wager'|'open'|'answer'|'result';

export function dailyDoubleStep(current:Current):DailyDoubleStep{
  if(current.closed)return 'result';
  if(current.phase!=='wager')return 'answer';
  if(!current.dailyDoubleFromId)return 'chooser';
  if(!current.answeringId)return 'opponent';
  return current.wagers[current.answeringId]?.submitted?'open':'wager';
}

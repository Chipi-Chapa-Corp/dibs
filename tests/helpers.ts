import {act} from '../server/engine.ts';
import type {Game} from '../shared/model.ts';

// Gameplay fixtures start after the teams have completed the lobby ready step.
export function markTeamsReady(game:Game){
  for(const team of game.players)act(game,'ready',{ready:true},'player',team.id);
}
export function startReadyGame(game:Game){markTeamsReady(game);act(game,'start');}

export function collectMissingFinalWagers(game:Game){
  for(const team of game.players)if(!game.current!.wagers[team.id])act(game,'hostWager',{playerId:team.id,wager:0});
}
export function lockFinalAnswers(game:Game){act(game,'lockFinalAnswers',{questionId:game.current!.questionId});}

import type {GameView} from '../shared/model';
import {HostClueMedia} from './media-context';
import {HostImageControl} from './HostImageControl';
import {AnswerChoices,RichText} from './components';

export function HostClue({g,command}:{g:GameView;command:(action:string,data?:Record<string,unknown>)=>Promise<boolean>}){
  const q=g.currentQuestion!;
  return <HostClueMedia.Provider value={{g,command,clueOnly:true}}><div className="host-clue"><HostImageControl g={g}/><RichText text={q.prompt}/><AnswerChoices question={q}/></div></HostClueMedia.Provider>;
}

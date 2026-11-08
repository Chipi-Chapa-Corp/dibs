import {useContext,useState} from 'react';
import {Play,Square,RotateCcw,AudioLines} from 'lucide-react';
import {HostClueMedia,PresenterFeedback} from './media-context';

const time=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
export function HostAudioControls({src}:{src:string}){
  const control=useContext(HostClueMedia),{connected,presenters}=useContext(PresenterFeedback);
  const[busy,setBusy]=useState(false);
  if(!control)return null;
  const{g,command}=control;
  const status=presenters.find(p=>{try{return new URL(p.mediaSource||'',location.href).href===new URL(src,location.href).href;}catch{return false;}});
  const ended=!!control.clueOnly&&!!(g.current?.closed||g.current?.revealed||g.current?.revealAt);
  const state=ended?'Question ended':!presenters.length?'No presenter connected':status?.mediaState==='playing'?'Playing on presenter':status?.mediaState==='ended'?'Finished':status?.mediaState==='blocked'?'Playback blocked':status?.mediaState==='paused'?'Paused':'Ready';
  const run=async(operation:'start'|'stop'|'restart')=>{
    setBusy(true);
    try{await command('controlPresenterMedia',{questionId:g.current?.questionId,source:src,operation});}finally{setBusy(false);}
  };
  const disabled=busy||!connected||!presenters.length||!src;
  return <section className="host-audio-controls" aria-label="Presenter audio">
    <div className="host-audio-heading"><AudioLines size={24}/><div><strong>Presenter audio</strong><span role="status">{state}</span></div>{!!status?.mediaDuration&&<span className="host-audio-time">{time(status.mediaTime||0)} / {time(status.mediaDuration)}</span>}</div>
    <div className="host-audio-actions"><button type="button" className="button primary" disabled={disabled||g.paused||ended} onClick={()=>void run('start')}><Play size={18}/>Start</button><button type="button" className="button" disabled={disabled} onClick={()=>void run('stop')}><Square size={18}/>Stop</button><button type="button" className="button" disabled={disabled||g.paused||ended} onClick={()=>void run('restart')}><RotateCcw size={18}/>Restart</button></div>
  </section>;
}

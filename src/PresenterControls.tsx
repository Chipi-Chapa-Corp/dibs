import {useState} from 'react';
import {Maximize,Minimize,Volume2,VolumeX,Play,Pause,ExternalLink} from 'lucide-react';
import type {GameView,PresenterStatus} from '../shared/model';
import {AppLink} from './navigation';
import {Button} from './components';
import {HostAudioControls} from './HostAudioControls';
import {HostClueMedia} from './media-context';

export function PresenterControls({g,presenters,connected,command}:{g:GameView;presenters:PresenterStatus[];connected:boolean;command:(action:string,data?:Record<string,unknown>)=>Promise<boolean>}){
  const[busy,setBusy]=useState(false);
  const fullscreen=presenters.length>0&&presenters.every(p=>p.fullscreen),sound=!!g.presenter?.sound;
  const media=/<(?:video|audio)\b|\.(?:mp4|webm|ogv|mp3|wav|ogg|m4a)\b|youtu(?:be\.com|\.be)\//i.test([g.currentQuestion?.prompt,g.current?.revealed?g.currentQuestion?.answer:''].join('\n'));
  const audio=/<audio\b|\.(?:mp3|wav|ogg|m4a)\b/i.test(g.currentQuestion?.prompt||'');
  const errors=[...new Set(presenters.flatMap(p=>[p.fullscreenError,p.soundError,p.mediaError].filter(Boolean)))];
  const set=async(data:Record<string,boolean>)=>{setBusy(true);try{await command('setPresenter',data);}finally{setBusy(false);}};
  return <div className="presenter-controls">
    <p role="status">{presenters.length?`${presenters.length} presenter ${presenters.length===1?'display connected':'displays connected'}`:'No presenter display connected'}</p>
    <div className="host-more-actions">
      <Button disabled={!connected||busy||!presenters.length} aria-pressed={fullscreen} onClick={()=>void set({fullscreen:!fullscreen})}>{fullscreen?<Minimize size={20}/>:<Maximize size={20}/>} {fullscreen?'Exit presenter fullscreen':'Presenter fullscreen'}</Button>
      <Button disabled={!connected||busy} aria-pressed={sound} onClick={()=>void set({sound:!sound})}>{sound?<Volume2 size={20}/>:<VolumeX size={20}/>} {sound?'Mute presenter sound':'Enable presenter sound'}</Button>
      {media&&!audio&&<Button disabled={!connected||busy||!presenters.length} aria-pressed={!!g.presenter?.mediaPlaying} onClick={()=>void set({mediaPlaying:!g.presenter?.mediaPlaying})}>{g.presenter?.mediaPlaying?<Pause size={20}/>:<Play size={20}/>} {g.presenter?.mediaPlaying?'Pause presenter media':'Play presenter media'}</Button>}
      <AppLink className="button" href={`/stage/${g.id}`} target="_blank" rel="noreferrer"><ExternalLink size={20}/>Open presenter</AppLink>
    </div>
    {audio&&<HostClueMedia.Provider value={{g,command}}><HostAudioControls src={presenters.find(p=>p.mediaSource)?.mediaSource||''}/></HostClueMedia.Provider>}
    {errors.map(error=><p className="presenter-control-error" role="status" key={error}>{error}</p>)}
  </div>;
}

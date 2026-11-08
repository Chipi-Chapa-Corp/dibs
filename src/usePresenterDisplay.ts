import {useEffect,useRef} from 'react';
import type {GameView,PresenterStatus} from '../shared/model';
import {GameSounds} from './sound';
import {audioAnalysis,resumeAudioAnalysis,closeAudioAnalysis} from './audio-analysis';
import {applyMediaRequest} from './media-playback';
import type {MediaRequest} from './media-playback';

/** Apply host requests without adding any interaction to the display. */
export function usePresenterDisplay(g:GameView,report:(status:Omit<PresenterStatus,'id'>)=>void){
  const root=useRef<HTMLDivElement>(null),sounds=useRef<GameSounds|null>(null),requests=useRef(new WeakMap<HTMLMediaElement,MediaRequest>());
  if(!sounds.current)sounds.current=new GameSounds();
  useEffect(()=>{sounds.current!.update(g,!!g.presenter?.sound);},[g]);
  useEffect(()=>{
    let disposed=false,last='',fullscreenError:string|undefined,mediaError:string|undefined;
    const audio=sounds.current!,desired=g.presenter,container=root.current;
    if(desired?.sound)audio.unlock();
    const active=()=>g.current?.revealed?container?.querySelector('.stage-answer')||container:container;
    const source=(media:HTMLMediaElement)=>media.currentSrc||media.src||media.querySelector('source')?.src||'';
    const matches=(media:HTMLMediaElement)=>{
      if(!active()?.contains(media))return false;
      if(!desired?.mediaSource)return true;
      try{return new URL(source(media),location.href).href===new URL(desired.mediaSource,location.href).href;}catch{return false;}
    };
    const emit=()=>{
      if(disposed)return;
      const media=Array.from(container?.querySelectorAll<HTMLMediaElement>('audio,video')||[]).find(matches);
      const graph=media?.tagName==='AUDIO'?audioAnalysis(media):null;
      const analysisBlocked=!!desired?.mediaPlaying&&!!graph&&graph.context.state!=='running';
      const mediaState:PresenterStatus['mediaState']=media?.error||analysisBlocked?'blocked':media?.ended?'ended':media&&!media.paused?'playing':media&&media.currentTime>0?'paused':'idle';
      const status:Omit<PresenterStatus,'id'>={fullscreen:!!document.fullscreenElement,sound:!!desired?.sound&&audio.state==='running',fullscreenError:document.fullscreenElement?undefined:fullscreenError,
        mediaError:analysisBlocked?'Display browser blocked audio. Allow autoplay for this site on the display device.':mediaError,
        mediaState,mediaSource:media?source(media):'',mediaTime:media?Math.round(media.currentTime*10)/10:0,mediaDuration:media&&Number.isFinite(media.duration)?Math.round(media.duration*10)/10:0,
        soundError:desired?.sound&&audio.state!=='running'?'Display browser blocked sound. Allow autoplay for this site on the display device.':undefined};
      const key=JSON.stringify(status);
      if(key!==last){last=key;report(status);}
    };
    if(desired?.fullscreen&&!document.fullscreenElement){
      if(!document.documentElement.requestFullscreen)fullscreenError='Fullscreen is not supported by this display browser.';
      else void document.documentElement.requestFullscreen().catch(()=>{fullscreenError='Display browser blocked fullscreen. Allow automatic fullscreen for this site, or start the display browser in kiosk mode.';emit();});
    }else if(desired&&!desired.fullscreen&&document.fullscreenElement){
      void document.exitFullscreen().catch(()=>{fullscreenError='The display browser could not exit fullscreen.';emit();});
    }
    const iframes=new Set<HTMLIFrameElement>();
    const applyMedia=()=>{
      const playing=!!desired?.mediaPlaying&&!g.paused&&(g.status==='playing'||g.status==='finished');
      container?.querySelectorAll<HTMLMediaElement>('video,audio').forEach(media=>{
        const shouldPlay=playing&&matches(media);
        media.controls=false;media.muted=!desired?.sound;
        if(shouldPlay&&media.tagName==='AUDIO')resumeAudioAnalysis(media);
        const result=applyMediaRequest(media,desired,shouldPlay,requests.current.get(media));
        requests.current.set(media,result.request);
        if(result.playing)void result.playing.then(()=>{mediaError=undefined;emit();}).catch(()=>{mediaError='Display could not play media. Check the file and browser autoplay permission.';emit();});
      });
      container?.querySelectorAll<HTMLIFrameElement>('iframe').forEach(frame=>{
        if(!iframes.has(frame)){iframes.add(frame);frame.addEventListener('load',applyMedia);}
        try{
          const url=new URL(frame.src);
          if(url.hostname!=='www.youtube-nocookie.com')return;
          for(const func of [desired?.sound?'unMute':'mute',playing&&active()?.contains(frame)?'playVideo':'pauseVideo'])frame.contentWindow?.postMessage(JSON.stringify({event:'command',func,args:[]}),url.origin);
        }catch{/* A missing embedded frame does not interrupt the game. */}
      });
    };
    const observer=new MutationObserver(()=>{applyMedia();emit();});
    if(container)observer.observe(container,{childList:true,subtree:true});
    const events=['play','pause','ended','timeupdate','loadedmetadata','seeked','error'];
    for(const event of events)container?.addEventListener(event,emit,true);
    applyMedia();emit();document.addEventListener('fullscreenchange',emit);
    const timer=setInterval(emit,300);
    return()=>{disposed=true;clearInterval(timer);observer.disconnect();document.removeEventListener('fullscreenchange',emit);for(const event of events)container?.removeEventListener(event,emit,true);for(const frame of iframes)frame.removeEventListener('load',applyMedia);};
  },[g.id,g.presenter?.version,g.paused,g.current?.questionId,g.current?.phase,g.current?.revealed,g.status,report]);
  useEffect(()=>()=>{sounds.current?.close();closeAudioAnalysis();},[]);
  return root;
}

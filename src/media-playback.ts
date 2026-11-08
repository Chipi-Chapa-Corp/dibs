import type {PresenterSettings} from '../shared/model';

export interface MediaRequest { command:number; reset:number; play:boolean }
/** Stop seeks to the start; pause/resume and unrelated display changes never replay an ended track. */
export function applyMediaRequest(media:Pick<HTMLMediaElement,'paused'|'ended'|'currentTime'|'play'|'pause'>,settings:PresenterSettings|undefined,shouldPlay:boolean,previous?:MediaRequest){
  const request={command:settings?.mediaCommandVersion||0,reset:settings?.mediaResetVersion||0,play:shouldPlay};
  const commandChanged=!previous||previous.command!==request.command;
  if(!previous||previous.reset!==request.reset){media.pause();try{media.currentTime=0;}catch{}}
  if(!shouldPlay)media.pause();
  else if(commandChanged||!previous?.play){
    if(media.ended)try{media.currentTime=0;}catch{}
    if(media.paused)return{request,playing:media.play()};
  }
  return{request,playing:undefined};
}

export function waveformPoints(samples:ArrayLike<number>,width:number,height:number,count=256){
  const middle=height/2;
  let peak=0;for(let i=0;i<samples.length;i++)if(Number.isFinite(samples[i]))peak=Math.max(peak,Math.abs(samples[i]));
  const gain=Math.min(24,.65/Math.max(.027,peak));
  return Array.from({length:count},(_,i)=>{
    const fraction=i/(count-1),value=Number(samples[Math.floor(fraction*Math.max(0,samples.length-1))])||0;
    const taper=Math.sin(Math.PI*fraction)**.7;
    return{x:fraction*width,y:middle+Math.max(-1,Math.min(1,value*gain))*height*.42*taper};
  });
}

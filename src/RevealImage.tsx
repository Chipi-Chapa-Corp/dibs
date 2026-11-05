import {useEffect,useRef,useState} from 'react';
import type {ImgHTMLAttributes} from 'react';
import {IMAGE_REVEAL_MS} from '../shared/image-reveal';

/** Keep the layout fixed while progressively uncovering the image. */
export function RevealImage({revealAt,revealPausedAt,onLoad,onError,style,...props}:ImgHTMLAttributes<HTMLImageElement>&{revealAt?:number;revealPausedAt?:number}){
  const image=useRef<HTMLImageElement>(null);
  const [loaded,setLoaded]=useState(false),[progress,setProgress]=useState(0);
  useEffect(()=>{if(image.current?.complete&&image.current.naturalWidth>0)setLoaded(true);},[]);
  useEffect(()=>{
    if(!loaded)return;
    const start=revealAt??Date.now();
    let frame:number|undefined;
    const uncover=()=>{
      const next=Math.min(1,Math.max(0,((revealPausedAt??Date.now())-start)/IMAGE_REVEAL_MS));
      setProgress(next);
      if(next<1&&revealPausedAt===undefined)frame=requestAnimationFrame(uncover);
    };
    uncover();
    return()=>{if(frame!==undefined)cancelAnimationFrame(frame);};
  },[loaded,revealAt,revealPausedAt]);
  return <img {...props} ref={image} loading="eager" style={{...style,clipPath:`inset(0 0 ${(1-progress)*100}% 0)`}} onLoad={event=>{setLoaded(true);onLoad?.(event);}} onError={event=>{setProgress(1);onError?.(event);}}/>;
}

import {useEffect,useRef} from 'react';
import type {AudioHTMLAttributes} from 'react';
import {audioAnalysis,releaseAudioAnalysis} from './audio-analysis';
import {waveformPoints} from './media-playback';

export function PresenterAudio(props:AudioHTMLAttributes<HTMLAudioElement>){
  const audio=useRef<HTMLAudioElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const media=audio.current!,surface=canvas.current!,draw=surface.getContext('2d');
    if(!draw)return;
    let frame:number|undefined;
    const samples=new Float32Array(1024),reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const paint=()=>{
      const width=surface.clientWidth,height=surface.clientHeight,ratio=devicePixelRatio||1;
      if(surface.width!==Math.round(width*ratio)||surface.height!==Math.round(height*ratio)){surface.width=Math.round(width*ratio);surface.height=Math.round(height*ratio);}
      draw.setTransform(ratio,0,0,ratio,0,0);draw.clearRect(0,0,width,height);
      samples.fill(0);
      if(!media.paused&&!media.ended&&!media.muted&&!reduced.matches)audioAnalysis(media)?.analyser.getFloatTimeDomainData(samples);
      const points=waveformPoints(samples,width,height),color=getComputedStyle(surface).color;
      draw.strokeStyle=color;draw.globalAlpha=.14;draw.lineWidth=1;draw.beginPath();draw.moveTo(0,height/2);draw.lineTo(width,height/2);draw.stroke();
      draw.beginPath();draw.moveTo(0,height/2);
      for(let i=1;i<points.length-1;i++)draw.quadraticCurveTo(points[i].x,points[i].y,(points[i].x+points[i+1].x)/2,(points[i].y+points[i+1].y)/2);
      draw.lineTo(width,height/2);draw.globalAlpha=1;draw.lineWidth=2.5;draw.lineCap='round';draw.lineJoin='round';draw.stroke();
      if(!media.paused&&!media.ended&&!reduced.matches)frame=requestAnimationFrame(paint);
    };
    const refresh=()=>{
      if(frame!==undefined)cancelAnimationFrame(frame);paint();
    };
    for(const event of ['play','pause','ended','loadedmetadata','seeked','volumechange','error'])media.addEventListener(event,refresh);
    const resize=new ResizeObserver(()=>{if(media.paused||media.ended)paint();});resize.observe(surface);
    reduced.addEventListener('change',refresh);refresh();
    return()=>{if(frame!==undefined)cancelAnimationFrame(frame);resize.disconnect();reduced.removeEventListener('change',refresh);for(const event of ['play','pause','ended','loadedmetadata','seeked','volumechange','error'])media.removeEventListener(event,refresh);media.pause();releaseAudioAnalysis(media);};
  },[props.src]);
  return <div className="presenter-audio">
    <audio {...props} ref={audio} controls={false} autoPlay={false} loop={false} preload="metadata" muted hidden/>
    <div className="audio-wave-shell"><canvas ref={canvas} className="audio-waveform" aria-hidden="true"/></div>
  </div>;
}

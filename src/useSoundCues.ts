import {useEffect,useRef,useState} from 'react';
import type {GameView} from '../shared/model';
import {GameSounds} from './sound';

export function useSoundCues(g:GameView|null,screen:'host'|'stage',preview=false){
  const [muted,setMuted]=useState(()=>{
    try{const saved=sessionStorage.getItem(`jeopardy:sound:${screen}`);return saved===null?screen==='stage':saved!=='on';}
    catch{return screen==='stage';}
  });
  const sounds=useRef<GameSounds|null>(null);
  if(!sounds.current)sounds.current=new GameSounds();
  useEffect(()=>{
    if(preview||muted)return;
    const unlock=()=>sounds.current?.unlock();
    document.addEventListener('pointerdown',unlock);
    // Keyboard activation of a button is also a browser-approved audio gesture.
    document.addEventListener('click',unlock);
    return()=>{document.removeEventListener('pointerdown',unlock);document.removeEventListener('click',unlock);};
  },[muted,preview]);
  useEffect(()=>{if(g)sounds.current?.update(g,!muted&&!preview);},[g,muted,preview]);
  useEffect(()=>()=>sounds.current?.close(),[]);
  const toggleSound=()=>{
    const next=!muted;
    if(!next)sounds.current?.unlock();
    setMuted(next);
    try{sessionStorage.setItem(`jeopardy:sound:${screen}`,next?'off':'on');}catch{}
  };
  return{muted,toggleSound};
}

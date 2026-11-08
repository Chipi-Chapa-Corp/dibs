import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Maximize,X} from 'lucide-react';
import type {GameView} from '../shared/model';
import {themeStyle} from './lib';
import {Button,RichText} from './components';

export function HostImageControl({g}:{g:GameView}){
  const c=g.current,q=g.currentQuestion;
  const[enlargedId,setEnlargedId]=useState<string|null>(null);
  const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null);
  const available=!!c&&!!q&&/!\[|<img\b/i.test(q.prompt)&&['question','final'].includes(c.phase);
  const enlarged=available&&enlargedId===c?.questionId;
  useEffect(()=>{
    if(!enlarged)return;
    const modal=dialog.current!;
    modal.showModal();
    return()=>{modal.close();opener.current?.focus({preventScroll:true});};
  },[enlarged]);
  if(!available)return null;
  return <div className="host-image-controls">
    <button type="button" className="button" ref={opener} aria-haspopup="dialog" aria-expanded={enlarged} title="Enlarge the question image on this host screen" onClick={()=>setEnlargedId(c.questionId)}><Maximize size={18}/>Enlarge</button>
    {enlarged&&createPortal(<dialog ref={dialog} className="host-image-overlay" aria-label="Enlarged question image" style={themeStyle(g.theme)} onCancel={event=>{event.preventDefault();setEnlargedId(null);}}>
      <Button className="host-image-close" onClick={()=>setEnlargedId(null)}><X size={20}/>Close</Button>
      <RichText text={q.prompt} imagesOnly/>
    </dialog>,document.body)}
  </div>;
}

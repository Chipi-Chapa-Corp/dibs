import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {AppearancePreview} from './appearance-previews';
import {Maximize} from 'lucide-react';
import {IconButton,Modal,StageContent} from './components';

const frameDocument='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="presenter-preview-root"></div></body></html>';

function PresenterFrame({scene}:{scene:AppearancePreview}){
  const wrapper=useRef<HTMLDivElement>(null),frame=useRef<HTMLIFrameElement>(null);
  const[target,setTarget]=useState<HTMLElement|null>(null);
  const[scale,setScale]=useState(0),[visible,setVisible]=useState(false);
  const loaded=()=>setTarget(frame.current?.contentDocument?.getElementById('presenter-preview-root')||null);
  useEffect(()=>{
    const observer=new ResizeObserver(()=>setScale((wrapper.current?.clientWidth||0)/1280));observer.observe(wrapper.current!);
    const visibility=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'400px'});visibility.observe(wrapper.current!);
    return()=>{observer.disconnect();visibility.disconnect();};
  },[]);
  useEffect(()=>{
    if(!target)return;
    const head=target.ownerDocument.head;
    const sync=()=>{
      head.querySelectorAll('[data-presenter-style]').forEach(node=>node.remove());
      for(const original of document.head.querySelectorAll('link[rel="stylesheet"],style')){
        const copy=original.cloneNode(true) as HTMLElement;
        copy.dataset.presenterStyle='';
        if(copy instanceof HTMLLinkElement)copy.href=(original as HTMLLinkElement).href;
        head.append(copy);
      }
    };
    sync();
    const observer=new MutationObserver(sync);observer.observe(document.head,{childList:true,subtree:true,characterData:true,attributes:true});
    return()=>observer.disconnect();
  },[target]);
  useEffect(()=>{if(!visible)setTarget(null);},[visible]);
  return <div className="presenter-frame" ref={wrapper}>
    {visible&&<iframe ref={frame} title={scene.title} srcDoc={frameDocument} tabIndex={-1} onLoad={loaded} style={{transform:`scale(${scale})`}}/>}
    {visible&&target&&createPortal(<StageContent g={scene.game} previewTime={scene.time}/>,target)}
  </div>;
}

export function AppearanceGallery({scenes,exampleTeams=false}:{scenes:AppearancePreview[];exampleTeams?:boolean}){
  const[expanded,setExpanded]=useState<string|null>(null),selected=scenes.find(s=>s.id===expanded);
  return <section className="appearance-gallery" aria-label="Presenter views"><div className="appearance-gallery-heading"><h2>Presenter views</h2><span>{exampleTeams?'Example teams · ':''}1280 × 720</span></div>
    <div className="appearance-views">{scenes.map(scene=><article className="appearance-view" key={scene.id}><div className="appearance-view-heading"><h3>{scene.title}</h3><IconButton title={`Expand ${scene.title}`} onClick={()=>setExpanded(scene.id)}><Maximize size={15}/></IconButton></div><PresenterFrame scene={scene}/></article>)}</div>
    {selected&&<Modal title={selected.title} wide onClose={()=>setExpanded(null)}><div className="appearance-expanded-view"><PresenterFrame scene={selected}/></div></Modal>}
  </section>;
}

import {useLayoutEffect,useRef} from 'react';
import type {ReactNode} from 'react';

// Measure the unscaled layout so content can shrink without clipping or scrolling.
export function ScreenFit({children}:{children:ReactNode}){
  const frame=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const outer=frame.current!,inner=content.current!;
    const fit=()=>{
      const width=outer.clientWidth,height=outer.clientHeight;
      if(!width||!height)return;
      const contentWidth=Math.max(inner.offsetWidth,inner.scrollWidth);
      const contentHeight=Math.max(inner.offsetHeight,inner.scrollHeight);
      const scale=Math.min(1,width/contentWidth,height/contentHeight);
      inner.style.transform=`translate(${(width-contentWidth*scale)/2}px, ${(height-contentHeight*scale)/2}px) scale(${scale})`;
    };
    const observer=new ResizeObserver(fit);
    observer.observe(outer);observer.observe(inner);
    // A wider board can overflow without changing the content's border box.
    const changes=new MutationObserver(fit);
    changes.observe(inner,{childList:true,characterData:true,subtree:true});
    // Media and lazy-loaded rich text can change size after the initial render.
    outer.addEventListener('load',fit,true);
    fit();
    return()=>{observer.disconnect();changes.disconnect();outer.removeEventListener('load',fit,true);};
  },[]);
  return <div className="screen-fit" ref={frame}><div className="screen-fit-content" ref={content}>{children}</div></div>;
}

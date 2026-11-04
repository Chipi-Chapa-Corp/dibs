import {useSyncExternalStore} from 'react';
import type {AnchorHTMLAttributes,MouseEvent} from 'react';
import {flushAutosaves} from './autosave';

const listeners=new Set<()=>void>();
let currentUrl=location.href;
let currentIndex=Number(history.state?.dibsNavigationIndex)||0;
let navigating=false;
let restoring=false;
history.replaceState({...history.state,dibsNavigationIndex:currentIndex},'',currentUrl);
const notify=()=>{for(const listener of listeners)listener();};
const isAppUrl=(url:URL)=>url.origin===location.origin&&/^\/(?:$|(?:edit|host|stage|play)(?:\/|$))/.test(url.pathname);

// Keep the current editor mounted until pending changes have reached the server.
window.addEventListener('popstate',async()=>{
  if(restoring){restoring=false;return;}
  const targetUrl=location.href,targetIndex=Number(history.state?.dibsNavigationIndex)||0;
  if(await flushAutosaves()){
    if(location.href!==targetUrl)return;
    currentUrl=targetUrl;currentIndex=targetIndex;notify();
  }else if(currentIndex!==targetIndex){
    restoring=true;history.go(currentIndex-targetIndex);
  }else{
    history.replaceState({...history.state,dibsNavigationIndex:currentIndex},'',currentUrl);
  }
});

export function usePathname(){
  return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>new URL(currentUrl).pathname);
}
export async function go(href:string){
  const url=new URL(href,location.href);
  if(!isAppUrl(url)){location.assign(url.href);return;}
  if(navigating||url.href===currentUrl)return;
  navigating=true;
  const from=currentUrl;
  try{
    if(!await flushAutosaves()||currentUrl!==from)return;
    currentIndex++;
    history.pushState({dibsNavigationIndex:currentIndex},'',url.href);
    currentUrl=url.href;notify();window.scrollTo(0,0);
  }finally{navigating=false;}
}
export function AppLink({href,onClick,target,download,...props}:AnchorHTMLAttributes<HTMLAnchorElement>){
  const navigate=(event:MouseEvent<HTMLAnchorElement>)=>{
    onClick?.(event);
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||target&&target!=='_self'||download!==undefined||!href)return;
    const url=new URL(href,location.href);
    if(!isAppUrl(url)||url.pathname===location.pathname&&url.search===location.search&&url.hash!==location.hash)return;
    event.preventDefault();void go(href);
  };
  return <a {...props} href={href} onClick={navigate} target={target} download={download}/>;
}

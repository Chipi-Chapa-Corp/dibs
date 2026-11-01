import {useCallback,useEffect,useRef,useState} from 'react';

type Save=(data:Record<string,unknown>)=>Promise<boolean>;
const editors=new Set<()=>Promise<boolean>>();
export async function flushAutosaves(){
  return (await Promise.all([...editors].map(flush=>flush()))).every(Boolean);
}

export function useAutosave(save:Save){
  const latest=useRef(save);latest.current=save;
  const pending=useRef<Record<string,unknown>|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const queue=useRef<Promise<boolean>>(Promise.resolve(true));
  const version=useRef(0);
  const mounted=useRef(true);
  const [status,setStatus]=useState<'saved'|'saving'|'error'>('saved');
  const flush=useCallback(()=>{
    if(timer.current){clearTimeout(timer.current);timer.current=null;}
    const data=pending.current;
    if(!data)return queue.current;
    pending.current=null;
    const revision=version.current;
    queue.current=queue.current.then(async()=>{
      let ok=false;
      try{ok=await latest.current(data);}catch{/* Keep the draft available to retry. */}
      if(revision===version.current){
        if(!ok)pending.current={...data,...pending.current};
        if(mounted.current)setStatus(ok?'saved':'error');
      }
      return ok;
    });
    return queue.current;
  },[]);
  const schedule=useCallback((data:Record<string,unknown>,delay=450)=>{
    version.current++;
    pending.current={...pending.current,...data};
    if(timer.current)clearTimeout(timer.current);
    setStatus('saving');
    if(delay>0)timer.current=setTimeout(()=>void flush(),delay);
    else void flush();
  },[flush]);
  useEffect(()=>{
    mounted.current=true;editors.add(flush);
    const leaving=()=>void flush();
    const visibility=()=>{if(document.visibilityState==='hidden')void flush();};
    window.addEventListener('pagehide',leaving);
    document.addEventListener('visibilitychange',visibility);
    return()=>{
      mounted.current=false;
      window.removeEventListener('pagehide',leaving);
      document.removeEventListener('visibilitychange',visibility);
      void flush().finally(()=>editors.delete(flush));
    };
  },[flush]);
  return{schedule,status,retry:flush};
}

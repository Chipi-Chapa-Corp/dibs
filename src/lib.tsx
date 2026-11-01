import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {io,Socket} from 'socket.io-client';
import type {CSSProperties,ReactNode} from 'react';
import type {GameView,Theme,GameSummary,Player} from '../shared/model';
export const number=(n:number)=>new Intl.NumberFormat('en-US').format(n);
export const hostKey=(id:string)=>localStorage.getItem(`jeopardy:host:${id}`)||'';
export const playerKey=(id:string)=>localStorage.getItem(`jeopardy:player:${id}`)||'';
export async function api<T=any>(url:string,data?:unknown,key?:string):Promise<T>{const res=await fetch(url,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(key?{Authorization:`Bearer ${key}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});const result=await res.json();if(!res.ok)throw new Error(result.error||'Something went wrong');return result;}
export const ToastContext=createContext<(message:string)=>void>(()=>{});
export const useToast=()=>useContext(ToastContext);
export function ToastProvider({children}:{children:ReactNode}){const[message,set]=useState('');useEffect(()=>{if(!message)return;const t=setTimeout(()=>set(''),4500);return()=>clearTimeout(t);},[message]);return <ToastContext.Provider value={set}>{children}{message&&<div className="toast" role="status" onClick={()=>set('')}>{message}</div>}</ToastContext.Provider>}
export function useGame(id:string,role:GameView['role']){
  const[g,set]=useState<GameView|null>(null),[connected,setConnected]=useState(false),[error,setError]=useState('');const socket=useRef<Socket|null>(null);const toast=useToast();
  useEffect(()=>{let key=role==='host'?hostKey(id):role==='player'?playerKey(id):'';if(role==='host'&&location.hash.startsWith('#key=')){key=decodeURIComponent(location.hash.slice(5));localStorage.setItem(`jeopardy:host:${id}`,key);history.replaceState(null,'',location.pathname);}
    const s=io({reconnection:true});socket.current=s;
    s.on('connect',()=>s.timeout(8000).emit('subscribe',{gameId:id,role,token:key},(err:Error|null,result:{ok:boolean;error?:string})=>{if(err||!result?.ok){setError(result?.error||'Could not connect');setConnected(false);}else{setConnected(true);setError('');}}));s.on('state',(state:GameView)=>{set(state);setError('');});s.on('disconnect',()=>setConnected(false));s.on('connect_error',()=>setConnected(false));s.on('revoked',(message:string)=>{setError(message);setConnected(false);});return()=>{s.disconnect();socket.current=null;};
  },[id,role]);
  const command=(action:string,data:Record<string,unknown>={})=>new Promise<boolean>(resolve=>{if(!socket.current?.connected){toast('Connection lost. Reconnecting…');resolve(false);return;}socket.current.timeout(8000).emit('command',{action,data},(err:Error|null,result:{ok:boolean;error?:string})=>{if(err||!result?.ok){toast(result?.error||'The server did not respond');resolve(false);}else resolve(true);});});
  return{g,connected,error,command};
}
export function useGames(){const[games,set]=useState<GameSummary[]>([]);const[connected,online]=useState(false);useEffect(()=>{const s=io();s.on('games',set);s.on('connect',()=>online(true));s.on('disconnect',()=>online(false));api('/api/games').then(set).catch(()=>{});return()=>{s.disconnect();};},[]);return{games,connected};}
export function themeStyle(t:Theme):CSSProperties{return{'--paper':t.paper,'--ink':t.ink,'--accent':t.accent,'--surface':t.surface,'--muted':t.muted,'--line':t.line,'--display':t.displayFont==='serif'?"'PT Serif',Georgia,serif":"'Golos Text',Arial,sans-serif",'--on-accent':contrast(t.accent),'--motion':t.motion?'1':'0'}as CSSProperties;}
export function contrast(hex:string){const n=parseInt(hex.slice(1),16);return ((n>>16)*.299+((n>>8)&255)*.587+(n&255)*.114)>155?'#252620':'#fff9ee';}
export const sortedPlayers=(players:Pick<Player,'id'|'name'|'score'|'color'>[])=>[...players].sort((a,b)=>b.score-a.score);
export function useNow(){const[now,set]=useState(Date.now());useEffect(()=>{const t=setInterval(()=>set(Date.now()),100);return()=>clearInterval(t);},[]);return now;}
export async function copy(value:string){try{await navigator.clipboard.writeText(value);}catch{const el=document.createElement('textarea');el.value=value;document.body.append(el);el.select();document.execCommand('copy');el.remove();}}
export function download(name:string,data:unknown){const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export const go=(url:string)=>{location.href=url;};

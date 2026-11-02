import {useEffect,useState} from 'react';
import {ArrowRight,Copy,KeyRound} from 'lucide-react';
import {api,copy,go,hostKey,useToast} from './lib';
import {Button,Field,Logo,Modal,QR} from './components';

export function HostTransferDialog({id,onClose}:{id:string;onClose:()=>void}){
  const[link,setLink]=useState(''),[expiresAt,setExpiresAt]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[addresses,setAddresses]=useState<string[]>([location.origin]),[base,setBase]=useState(location.origin);
  const toast=useToast();
  useEffect(()=>{
    api(`/api/games/${id}/host-transfer`,undefined,hostKey(id)).then(v=>setExpiresAt(v.expiresAt)).catch(e=>setError(e.message));
    api('/api/network').then(v=>{const options=[...new Set<string>([...v.addresses,location.origin])];setAddresses(options);setBase(options[0]);}).catch(()=>{});
  },[id]);
  const create=async()=>{
    setBusy(true);setError('');
    try{if(!hostKey(id))throw Error('Host access is no longer available.');const v=await api(`/api/games/${id}/host-transfer`,{},hostKey(id));setExpiresAt(v.expiresAt);setLink(`#token=${v.transferToken}`);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const cancel=async()=>{
    setBusy(true);setError('');
    try{await api(`/api/games/${id}/host-transfer`,undefined,hostKey(id),'DELETE');setLink('');setExpiresAt(null);toast('Host transfer cancelled');}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const url=link?`${base}/host-transfer/${id}${link}`:'';
  return <Modal title="Transfer host access" onClose={onClose}>
    <p>Create a one-time link and open it in the browser that will host. Hosting moves only when that browser chooses “Take over hosting”. This browser then loses host access.</p>
    <p className="field-hint">The game, players and scores continue. Keep this server running, and share the link only with the next host.</p>
    {expiresAt&&<p className="field-hint">Link expires at {new Date(expiresAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}. Creating another link replaces it.</p>}
    {url&&<>
      {addresses.length>1&&<Field label="Server address"><select value={base} onChange={e=>setBase(e.target.value)}>{addresses.map(address=><option key={address} value={address}>{address}</option>)}</select></Field>}
      <div className="invite-layout"><QR value={url} size={190}/><div><Field label="One-time host link"><input readOnly value={url} onFocus={e=>e.target.select()}/></Field><Button disabled={busy} onClick={async()=>{await copy(url);toast('Host transfer link copied');}}><Copy size={18}/>Copy link</Button></div></div>
    </>}
    {error&&<p role="alert">{error}</p>}
    <div className="modal-actions">{expiresAt&&<Button disabled={busy} onClick={()=>void cancel()}>Cancel transfer</Button>}<Button variant="primary" disabled={busy} onClick={()=>void create()}><KeyRound size={18}/>{busy?'Working…':expiresAt?'Create replacement link':'Create transfer link'}</Button></div>
  </Modal>;
}

type PendingTransfer={transferToken:string;hostToken:string};
const validSecret=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{48}$/.test(value);

export function AcceptHostTransfer({id}:{id:string}){
  const[name,setName]=useState(''),[pending,setPending]=useState<PendingTransfer|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const pendingKey=`jeopardy:pending-host-transfer:${id}`;
  useEffect(()=>{
    try{
      const incoming=new URLSearchParams(location.hash.slice(1)).get('token');
      let saved:PendingTransfer|null=null;
      try{saved=JSON.parse(localStorage.getItem(pendingKey)||'null');}catch{}
      if(!saved||!validSecret(saved.transferToken)||!validSecret(saved.hostToken))saved=null;
      if(incoming){
        if(!validSecret(incoming))throw Error('Invalid host transfer link. Ask the current host for a new link.');
        if(saved?.transferToken!==incoming){
          const bytes=crypto.getRandomValues(new Uint8Array(24));
          saved={transferToken:incoming,hostToken:Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')};
        }
      }
      if(!saved)throw Error('The host transfer link is missing. Open the full link from the current host.');
      // Persist the replacement key before making any request that rotates access.
      localStorage.setItem(pendingKey,JSON.stringify(saved));setPending(saved);
      history.replaceState(null,'',location.pathname);
    }catch(e){setError((e as Error).message);}
    api(`/api/games/${id}`).then(g=>setName(g.name)).catch(e=>setError(e.message));
  },[id]);
  const accept=async()=>{
    if(!pending)return;
    setBusy(true);setError('');
    try{
      // Check storage again before handing off. Failed responses can be retried
      // with the same locally saved key, including after reloading this page.
      localStorage.setItem(pendingKey,JSON.stringify(pending));
      await api(`/api/games/${id}/host-transfer/accept`,pending);
      localStorage.setItem(`jeopardy:host:${id}`,pending.hostToken);
      localStorage.removeItem(pendingKey);go(`/host/${id}`);
    }catch(e){setError(`${(e as Error).message} You can retry here; the game is preserved.`);setBusy(false);}
  };
  return <main className="preparation-locked"><Logo/><span className="eyebrow">Host handoff · {id}</span><h1>{name||'Transfer host access'}</h1><p>Take over hosting in this browser? The previous host loses control. Players, scores, questions and game progress stay in place.</p>{error&&<p role="alert">{error}</p>}<div className="toolbar-actions"><a className="button" href="/">Game library</a><Button variant="primary" disabled={busy||!pending||!name} onClick={()=>void accept()}>{busy?'Transferring…':'Take over hosting'}<ArrowRight size={20}/></Button></div></main>;
}

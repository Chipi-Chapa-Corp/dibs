import {useMemo,useRef,useState} from 'react';
import {Check,RotateCcw} from 'lucide-react';
import type {AppearanceKey,GameView,Round,Theme,ThemeOverrides} from '../shared/model';
import {themes} from '../shared/model';
import {colorKeys,paletteKeys,pruneThemeOverrides,themeForRound} from '../shared/appearance';
import {IconButton,UploadMedia} from './components';
import {useAutosave} from './autosave';
import {appearancePreviews} from './appearance-previews';
import {AppearanceGallery} from './AppearanceGallery';

type Draft={theme:Theme;rounds:Round[]};
export function AppearanceEditor({g,save,editorId}:{g:GameView;editorId:string;save:(data:Record<string,unknown>)=>Promise<boolean>}){
  const[draft,setDraft]=useState<Draft>(()=>({theme:structuredClone(g.theme),rounds:structuredClone(g.rounds)}));
  const latest=useRef(draft);latest.current=draft;
  const[selected,setSelected]=useState<string|null>(null),autosave=useAutosave(save);
  const[backgroundDrafts,setBackgroundDrafts]=useState<Record<string,string>>({}),scope=selected||'shared';
  const round=draft.rounds.find(r=>r.id===selected),own=round?.theme||{},theme=themeForRound(draft.theme,own);
  const scenes=useMemo(()=>appearancePreviews({...g,...draft},selected),[g,draft,selected]);
  const commit=(next:Draft,delay:number)=>{
    next={...next,rounds:next.rounds.map(({theme:overrides,...r})=>{
      const inherited=pruneThemeOverrides(next.theme,overrides);
      return Object.keys(inherited).length?{...r,theme:inherited}:r;
    })};
    latest.current=next;setDraft(next);autosave.schedule(next,delay);
  };
  const patch=(data:ThemeOverrides,delay=0)=>{
    const current=latest.current;
    commit(selected?{...current,rounds:current.rounds.map(r=>r.id===selected?{...r,theme:{...r.theme,...data}}:r)}:{...current,theme:{...current.theme,...data}},delay);
  };
  const revert=(keys:readonly AppearanceKey[])=>{
    if(keys.includes('background'))setBackgroundDrafts(previous=>{const next={...previous};delete next[scope];return next;});
    const current=latest.current;
    commit({...current,rounds:current.rounds.map(r=>{
      if(r.id!==selected)return r;
      const next={...r.theme};for(const key of keys)delete next[key];return{...r,theme:next};
    })},0);
  };
  const reset=(keys:readonly AppearanceKey[],label:string)=>selected&&keys.some(key=>Object.hasOwn(own,key))?
    <IconButton className="appearance-revert" title={`Revert ${label} to Shared`} onClick={()=>revert(keys)}><RotateCcw size={17}/></IconButton>:null;
  const background=(value:string)=>{
    if(value!==''&&!/^(https?:\/\/|\/media\/)/.test(value)){setBackgroundDrafts(previous=>({...previous,[scope]:value}));return;}
    setBackgroundDrafts(previous=>{const next={...previous};delete next[scope];return next;});patch({background:value},450);
  };
  return <>
    <div className="appearance-scope"><div className="round-tabs appearance-tabs" role="tablist" aria-label="Appearance scope" onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      const tabs=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')),index=tabs.indexOf(event.target as HTMLButtonElement);
      const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;
      event.preventDefault();tabs[next].focus();tabs[next].click();
    }}>
      <button type="button" role="tab" tabIndex={!selected?0:-1} aria-selected={!selected} aria-controls="appearance-settings" className={!selected?'active':''} onClick={()=>setSelected(null)}>Shared</button>
      {draft.rounds.map(r=><button type="button" key={r.id} role="tab" tabIndex={selected===r.id?0:-1} aria-selected={selected===r.id} aria-controls="appearance-settings" className={selected===r.id?'active':''} onClick={()=>setSelected(r.id)}>{r.name}{!!Object.keys(r.theme||{}).length&&<i className="appearance-override-dot" role="img" aria-label="Has overrides"/>}</button>)}
    </div><span className="autosave-status" role="status">{autosave.status==='saving'?'Saving…':autosave.status==='error'?<button onClick={()=>void autosave.retry()}>Couldn’t save · retry</button>:null}</span></div>
    <div className="appearance-layout appearance-workspace">
      <section className="appearance-settings" id="appearance-settings" role="tabpanel" aria-label={round?.name||'Shared'}>
        <p className="appearance-inheritance">{selected?'Uses Shared unless you change a setting.':'Base settings for every round.'}</p>
        <div className="field"><div className="appearance-field-heading"><span>Theme</span>{reset(paletteKeys,'theme')}</div>
          <div className="theme-picks">{(Object.keys(themes)as Theme['preset'][]).map(k=><button type="button" className={`theme-pick ${theme.preset===k?'selected':''}`} aria-label={`${k[0].toUpperCase()+k.slice(1)} theme`} aria-pressed={theme.preset===k} style={{background:themes[k].paper,color:themes[k].ink}} key={k} onClick={()=>patch({preset:k,...themes[k]})}><span style={{color:themes[k].accent}}>Aa</span>{k[0].toUpperCase()+k.slice(1)}{theme.preset===k&&<Check size={18}/>}</button>)}</div>
        </div>
        <div className="field"><div className="appearance-field-heading"><label htmlFor="appearance-font">Display type</label>{reset(['displayFont'],'display type')}</div>
          <select id="appearance-font" value={theme.displayFont} onChange={e=>patch({displayFont:e.target.value as 'serif'|'sans'})}><option value="serif">Serif · editorial</option><option value="sans">Sans · modern</option></select>
        </div>
        <div className="appearance-colors">{colorKeys.map(key=><div className="appearance-color-row" key={key}>
          <input id={`appearance-${key}`} aria-label={`${key[0].toUpperCase()+key.slice(1)} color`} type="color" value={theme[key]} onChange={e=>patch({[key]:e.target.value},100)}/>
          <label htmlFor={`appearance-${key}`}>{key[0].toUpperCase()+key.slice(1)}</label><code>{theme[key]}</code>{reset([key],`${key} color`)}
        </div>)}</div>
        <div className="field"><div className="appearance-field-heading"><label htmlFor="appearance-background">Background image URL</label>{reset(['background'],'background image')}</div>
          <input id="appearance-background" value={backgroundDrafts[scope]??theme.background} onChange={e=>background(e.target.value)} placeholder="https://… or /media/…"/>
        </div>
        <UploadMedia id={g.id} editorId={editorId} onInsert={markup=>{const match=markup.match(/\]\(([^)]+)\)/);if(match)background(match[1]);}}/>
      </section>
      <AppearanceGallery scenes={scenes} exampleTeams={!g.players.length}/>
    </div>
  </>;
}

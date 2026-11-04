import {useState} from 'react';
import {Check,Minus,Plus} from 'lucide-react';
import type {GameView} from '../shared/model';
import {Button,Modal} from './components';
import {useToast} from './lib';

type Command=(action:string,data?:Record<string,unknown>)=>Promise<boolean>;
export function TeamsPanel({g,command,onClose}:{g:GameView;command:Command;onClose:()=>void}){
  const[drafts,setDrafts]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false);
  const[removeMember,setRemoveMember]=useState<string|null>(null),[removeTeam,setRemoveTeam]=useState<string|null>(null);
  const toast=useToast(),canEditTeams=g.status==='lobby'&&!g.teamsLocked;
  const changed=g.players.filter(team=>drafts[team.id]!==undefined&&drafts[team.id]!==String(team.score));
  const invalid=changed.some(team=>!drafts[team.id].trim()||!Number.isFinite(Number(drafts[team.id])));
  const setScore=(id:string,value:string)=>setDrafts(previous=>({...previous,[id]:value}));
  const save=async()=>{
    if(busy||invalid||!changed.length)return;
    setBusy(true);
    try{
      if(await command('adjustScores',{scores:changed.map(team=>({playerId:team.id,amount:Number(drafts[team.id])}))})){
        setDrafts({});toast('Scores saved');
      }
    }finally{setBusy(false);}
  };
  return <Modal title="Manage teams" wide onClose={()=>{if(!busy)onClose();}}>
    <form className="teams-panel" onSubmit={e=>{e.preventDefault();void save();}}>
      <div className="teams-panel-list">{g.players.map(team=>{
        const members=g.members.filter(member=>member.teamId===team.id),value=drafts[team.id]??String(team.score);
        return <section className="team-management-row" key={team.id} aria-label={team.name}>
          <div className="team-management-score">
            <h3><i className="player-marker" style={{background:team.color}}/>{team.name}</h3>
            <label className="field"><span>Score</span><input aria-label={`Score for ${team.name}`} type="number" required step={100} value={value} disabled={busy} onChange={e=>setScore(team.id,e.target.value)}/></label>
            <div className="team-score-steps">{[-500,-100,100,500].map(amount=><Button key={amount} type="button" disabled={busy} aria-label={`${amount>0?'Add':'Subtract'} ${Math.abs(amount)} points ${amount>0?'to':'from'} ${team.name}`} onClick={()=>setScore(team.id,String((Number(value)||0)+amount))}>{amount>0?<Plus size={16}/>:<Minus size={16}/>} {Math.abs(amount)}</Button>)}</div>
            {canEditTeams&&<Button type="button" variant="danger" disabled={busy} onClick={async()=>{
              if(removeTeam!==team.id){setRemoveTeam(team.id);return;}
              setBusy(true);try{if(await command('removeTeam',{playerId:team.id}))setRemoveTeam(null);}finally{setBusy(false);}
            }}>{removeTeam===team.id?'Confirm team removal':'Remove team'}</Button>}
          </div>
          <div className="team-management-players"><h4>Players · {members.length}</h4>
            {members.length?members.map(member=><div className="team-member" key={member.id}><div><strong>{member.name}</strong><span className="field-hint">{member.connected?'Connected':'Disconnected'}</span></div><Button type="button" variant="danger" disabled={busy} aria-label={`${removeMember===member.id?'Confirm removal of':'Remove'} ${member.name}`} onClick={async()=>{
              if(removeMember!==member.id){setRemoveMember(member.id);return;}
              setBusy(true);try{if(await command('removePlayer',{memberId:member.id}))setRemoveMember(null);}finally{setBusy(false);}
            }}>{removeMember===member.id?'Confirm removal':'Remove'}</Button></div>):<p className="field-hint">No players joined.</p>}
          </div>
        </section>;
      })}</div>
      <div className="teams-panel-actions"><Button type="button" disabled={busy} onClick={onClose}>Done</Button><Button type="submit" variant="primary" disabled={busy||invalid||!changed.length}><Check size={20}/>{busy?'Saving…':'Save scores'}</Button></div>
    </form>
  </Modal>;
}

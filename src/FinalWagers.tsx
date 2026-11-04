import {useState} from 'react';
import {ArrowRight} from 'lucide-react';
import type {GameView} from '../shared/model';
import {Button} from './components';
import {FinalOverride} from './FinalSubmission';
import {number} from './lib';

type Command=(action:string,data?:Record<string,unknown>)=>Promise<boolean>;
export function FinalWagers({g,command}:{g:GameView;command:Command}){
  const[busy,setBusy]=useState(false),c=g.current!;
  const complete=g.players.length>0&&g.players.every(team=>c.wagers[team.id]?.submitted);
  return <section className="wager-console final-wagers">
    <h2>Final wagers</h2>
    {g.players.map(team=>{const entry=c.wagers[team.id];return <div className="final-host-team" key={team.id}>
      <div className="final-wager-row"><span><i className="player-marker" style={{background:team.color}}/>{team.name}</span><strong>{entry?.submitted?number(entry.wager):'Waiting…'}</strong></div>
      <FinalOverride g={g} teamId={team.id} command={command}/>
    </div>;})}
    <Button variant="primary" disabled={busy||g.paused||!complete} onClick={async()=>{setBusy(true);try{await command('finalBegin');}finally{setBusy(false);}}}>{busy?'Locking wagers…':'Lock wagers & open question'}<ArrowRight size={20}/></Button>
  </section>;
}

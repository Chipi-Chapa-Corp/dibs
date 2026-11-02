import type {GameView} from '../shared/model';

type SoundSnapshot=Pick<GameView,'id'|'selection'|'announcement'|'paused'|'status'|'theme'>;

// One context per screen, unlocked by a user gesture and reused for every cue.
export class GameSounds {
  private context:AudioContext|null=null;
  private resuming:Promise<void>|null=null;
  private selectionKey:string|undefined;
  private announcementKey:string|undefined;
  private enabled=false;
  constructor(private createContext=()=>new AudioContext()){}

  unlock(){
    try{
      this.context??=this.createContext();
      if(this.context.state!=='running'&&!this.resuming){
        const resume=this.context.resume().catch(()=>{});
        this.resuming=resume;
        void resume.then(()=>{if(this.resuming===resume)this.resuming=null;});
      }
    }catch{/* Audio may be unavailable; game controls still work. */}
  }

  update(g:SoundSnapshot,enabled:boolean,now=Date.now()){
    const selectionKey=g.selection?`${g.id}:${g.selection.questionId}:${g.selection.opensAt}`:'';
    const announcementKey=g.announcement?`${g.id}:${g.announcement.id}`:'';
    const selectionChanged=this.selectionKey!==undefined&&selectionKey!==this.selectionKey;
    const announcementChanged=this.announcementKey!==undefined&&announcementKey!==this.announcementKey;
    // Consume muted events too, so unmuting or reconnecting cannot replay them.
    this.selectionKey=selectionKey;
    this.announcementKey=announcementKey;
    this.enabled=enabled&&!g.paused;
    if(!enabled||g.paused)return;
    if(selectionChanged&&g.selection&&g.status==='playing'&&g.selection.opensAt>now){
      const expires=Date.now()+g.selection.opensAt-now;
      const play=()=>{
        if(!this.enabled||this.selectionKey!==selectionKey||Date.now()>=expires)return;
        this.tone(659.25,0,.15,.055);
        this.tone(987.77,.1,.24,.045);
      };
      // The first click may reach the server before the audio device finishes waking.
      // Wait only for that gesture's resume; cancelled or expired selections stay silent.
      if(this.context?.state!=='running'&&this.resuming)void this.resuming.then(play);
      else play();
    }else if(announcementChanged&&g.theme.sound&&g.announcement&&now-g.announcement.at<3500){
      this.tone(520,0,.35,.06);
    }
  }

  private tone(frequency:number,delay:number,duration:number,volume:number){
    const a=this.context;
    if(!a||a.state!=='running')return;
    try{
      const osc=a.createOscillator(),gain=a.createGain(),start=a.currentTime+delay;
      osc.type='sine';osc.frequency.setValueAtTime(frequency,start);
      gain.gain.setValueAtTime(0,start);
      gain.gain.linearRampToValueAtTime(volume,start+.008);
      gain.gain.exponentialRampToValueAtTime(.001,start+duration);
      osc.connect(gain);gain.connect(a.destination);
      osc.onended=()=>{osc.disconnect();gain.disconnect();};
      osc.start(start);osc.stop(start+duration);
    }catch{/* Ignore audio failures without interrupting the game. */}
  }

  close(){
    this.enabled=false;
    if(this.context)void this.context.close().catch(()=>{});
    this.context=null;
  }
}

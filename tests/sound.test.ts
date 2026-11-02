import test from 'node:test';
import assert from 'node:assert/strict';
import {GameSounds} from '../src/sound';
import {defaultTheme} from '../shared/model';

function fixture(){
  const notes:{frequency:number;start:number;stop:number}[]=[];
  let contexts=0,resumes=0,closed=0;
  const param={setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}};
  const context={state:'suspended',currentTime:10,destination:{},
    resume(){resumes++;this.state='running';return Promise.resolve();},
    close(){closed++;this.state='closed';return Promise.resolve();},
    createGain(){return{gain:param,connect(){},disconnect(){}};},
    createOscillator(){
      const note={frequency:0,start:0,stop:0};notes.push(note);
      return{type:'',frequency:{setValueAtTime(f:number){note.frequency=f;}},connect(){},disconnect(){},
        start(at:number){note.start=at;},stop(at:number){note.stop=at;},onended:null};
    }};
  const sound=new GameSounds(()=>{contexts++;return context as unknown as AudioContext;});
  const g={id:'TEST',selection:null as {questionId:string;opensAt:number}|null,announcement:null as {id:string;at:number;title:string;detail:string}|null,paused:false,status:'playing' as const,theme:{...defaultTheme}};
  return{sound,g,notes,context,counts:()=>({contexts,resumes,closed})};
}

test('confirmed selections chime once, reusing a gesture-unlocked audio context',()=>{
  const{sound,g,notes,counts}=fixture();
  sound.update(g,true,1000);sound.unlock();sound.unlock();
  g.selection={questionId:'normal',opensAt:1800};sound.update(g,true,1000);
  assert.deepEqual(notes.map(n=>n.frequency),[659.25,987.77]);
  assert.equal(notes[0].start,10);assert.equal(notes[1].start,10.1);
  assert(notes.every(n=>n.stop-n.start<.4));
  sound.update({...g},true,1100);assert.equal(notes.length,2);
  g.selection=null;sound.update(g,true,1800);
  g.selection={questionId:'modifier',opensAt:2800};sound.update(g,true,2000);
  assert.equal(notes.length,4);assert.deepEqual(counts(),{contexts:1,resumes:1,closed:0});
  sound.close();assert.equal(counts().closed,1);
});

test('muted, paused, expired and initial snapshots do not replay selections',()=>{
  const{sound,g,notes}=fixture();sound.unlock();
  g.selection={questionId:'already-selected',opensAt:1800};sound.update(g,true,1000);
  assert.equal(notes.length,0);
  g.selection={questionId:'muted',opensAt:1800};sound.update(g,false,1000);
  sound.update(g,true,1100);assert.equal(notes.length,0);
  g.paused=true;g.selection={questionId:'paused',opensAt:1800};sound.update(g,true,1000);
  g.paused=false;sound.update(g,true,1100);assert.equal(notes.length,0);
  g.selection={questionId:'stale',opensAt:900};sound.update(g,true,1000);
  assert.equal(notes.length,0);
});

test('selection chimes work independently of announcement preferences; announcements retain their toggle',()=>{
  const{sound,g,notes}=fixture();sound.unlock();sound.update(g,true,1000);
  g.selection={questionId:'daily-double',opensAt:1800};sound.update(g,true,1000);
  assert.equal(notes.length,2);
  g.selection=null;g.announcement={id:'quiet',at:1800,title:'Claimed',detail:''};sound.update(g,true,1800);
  assert.equal(notes.length,2);
  g.theme.sound=true;sound.update(g,true,1800);assert.equal(notes.length,2);
  g.announcement={...g.announcement,id:'new',at:2000};sound.update(g,true,2000);
  assert.equal(notes.length,3);assert.equal(notes[2].frequency,520);
});

test('blocked or unavailable audio never queues a late cue or breaks play',()=>{
  const{sound,g,notes,context}=fixture();sound.update(g,true,1000);
  g.selection={questionId:'locked',opensAt:1800};sound.update(g,true,1000);
  assert.equal(notes.length,0);sound.unlock();sound.update(g,true,1100);assert.equal(notes.length,0);
  context.state='suspended';g.selection={questionId:'blocked',opensAt:1900};sound.update(g,true,1100);
  assert.equal(notes.length,0);
  const unavailable=new GameSounds(()=>{throw Error('Unavailable');});
  assert.doesNotThrow(()=>{unavailable.unlock();unavailable.update(g,true,1100);unavailable.close();});
});

test('the first selection waits for audio to wake, while muted or cancelled cues stay silent',async()=>{
  for(const cancel of ['none','mute','close']as const){
    const{sound,g,notes,context}=fixture();
    let wake!:()=>void;
    context.resume=()=>new Promise<void>(resolve=>{wake=()=>{context.state='running';resolve();};});
    sound.update(g,true,1000);sound.unlock();
    g.selection={questionId:'first-click',opensAt:1800};sound.update(g,true,1000);
    assert.equal(notes.length,0);
    if(cancel==='mute')sound.update(g,false,1000);
    if(cancel==='close'){g.selection=null;sound.update(g,true,1000);}
    wake();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(notes.length,cancel==='none'?2:0);
    sound.close();
  }
});

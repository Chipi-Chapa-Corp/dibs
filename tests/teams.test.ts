import {startReadyGame,markTeamsReady} from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {io,Socket} from 'socket.io-client';
import {act,addPlayer,createGame,joinMember,removeMember,view} from '../server/engine.ts';
import {startServer} from '../server/index.ts';
import {openGameStore} from '../server/storage.ts';
import {demoRounds} from '../shared/model.ts';
import type {GameView} from '../shared/model.ts';

test('only existing teams can be joined; each player has an independent credential',()=>{
  const g=createGame();assert.throws(()=>startReadyGame(g),/Create at least one team/);const team=addPlayer(g,'Red');
  assert.throws(()=>joinMember(g,{name:'Alice'}),/Choose a team/);
  assert.throws(()=>joinMember(g,{name:'Alice',teamId:'invented',teamName:'New team'}),/Choose a team/);
  const alice=joinMember(g,{name:'Alice',teamId:team.id}),bob=joinMember(g,{name:'Bob',teamId:team.id});
  assert.notEqual(alice.id,bob.id);assert.notEqual(alice.token,bob.token);
  assert.equal(joinMember(g,{token:alice.token,teamId:'invented',name:'Impersonation'}),alice);
  assert.equal(alice.name,'Alice');assert.equal(alice.teamId,team.id);assert.equal(g.players.length,1);
  for(const role of ['host','player','stage']as const){
    const snapshot=view(g,role,team.id,Date.now(),alice.id),json=JSON.stringify(snapshot);
    assert(!json.includes(alice.token));assert(!json.includes(bob.token));assert(!json.includes(team.token));
    assert.equal(snapshot.members.length,role==='stage'?0:2);
  }
});

test('teams stay fixed through play, pause, finish, resume and undo; reset starts fresh',()=>{
  const g=createGame({definition:{rounds:demoRounds()}});act(g,'addTeam',{name:'Red'});act(g,'addTeam',{name:'Blue'});
  const ids=g.players.map(t=>t.id),member=joinMember(g,{name:'Alice',teamId:ids[0]});
  startReadyGame(g);
  const rejectChanges=()=>{
    for(const action of ['addTeam','addPlayer','renameTeam','renamePlayer','removeTeam'])assert.throws(()=>act(g,action,{name:'New',playerId:ids[0]}),/fixed/);
    assert.deepEqual(g.players.map(t=>t.id),ids);
  };
  rejectChanges();act(g,'pause');rejectChanges();act(g,'finish');rejectChanges();act(g,'resume');rejectChanges();
  while(g.undo.length)act(g,'undo');
  assert(g.teamsLocked);rejectChanges();assert.equal(g.members[0].token,member.token);
  act(g,'reset');assert(!g.teamsLocked);assert.deepEqual(g.members,[]);assert.deepEqual(g.players,[]);
  act(g,'addTeam',{name:'Fresh team'});assert.equal(g.players.length,1);
});

test('player names are unique across teams, including disconnected players and case or space variants',()=>{
  const g=createGame(),red=addPlayer(g,'Red'),blue=addPlayer(g,'Blue');
  const alice=joinMember(g,{name:'Alice',teamId:red.id});
  for(const team of [red,blue])for(const name of ['Alice','ALICE',' alice ','Ａｌｉｃｅ']){
    const before=structuredClone(g);
    assert.throws(()=>joinMember(g,{name,teamId:team.id}),/player with this name has already joined/);
    assert.deepEqual(g,before);
  }
  const sasha=joinMember(g,{name:'Саша',teamId:blue.id});
  assert.throws(()=>joinMember(g,{name:' сАША ',teamId:red.id}),/player with this name has already joined/);
  assert.equal(joinMember(g,{token:alice.token}),alice);assert.equal(joinMember(g,{token:sasha.token}),sasha);
  removeMember(g,alice.id);assert.notEqual(joinMember(g,{name:'Alice',teamId:blue.id}).token,alice.token);
  const other=createGame(),otherTeam=addPlayer(other,'Red');assert.equal(joinMember(other,{name:'Alice',teamId:otherTeam.id}).name,'Alice');
});

test('concurrent HTTP joins cannot create duplicate player names',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dibs-unique-names-')),server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});
  try{
    const g=createGame(),red=addPlayer(g,'Red'),blue=addPlayer(g,'Blue');server.games.set(g.id,g);
    const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
    const join=async(name:string,teamId:string)=>{
      const response=await fetch(`${base}/api/games/${g.id}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,teamId})});
      return{status:response.status,body:await response.json()};
    };
    const results=await Promise.all([join('Alice',red.id),join(' alice ',blue.id)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(g.members.length,1);
    assert.match(results.find(r=>r.status===400)!.body.error,/player with this name has already joined/);
    await server.close();
    const restored=openGameStore(dir).games.get(g.id)!;
    assert.throws(()=>joinMember(restored,{name:'ALICE',teamId:red.id}),/player with this name has already joined/);
    assert.equal(joinMember(restored,{token:g.members[0].token}).id,g.members[0].id);
  }finally{await server.close();rmSync(dir,{recursive:true,force:true});}
});

test('membership changes cannot reset team progress or be undone to resurrect revoked credentials',()=>{
  const g=createGame({definition:{rounds:demoRounds(),settings:{earlyPenaltyMs:0}}}),team=addPlayer(g,'Red');
  const alice=joinMember(g,{name:'Alice',teamId:team.id}),bob=joinMember(g,{name:'Bob',teamId:team.id});
  startReadyGame(g);act(g,'openQuestion',{questionId:g.rounds[0].categories[0].questions[0].id});act(g,'openBuzzers');
  assert(!JSON.stringify(g.undo).includes(alice.token));assert(!JSON.stringify(g.undo).includes(bob.token));
  act(g,'buzz',{},'player',team.id);act(g,'judge',{correct:false});assert.equal(team.score,-100);
  removeMember(g,alice.id);assert.equal(g.players.length,1);assert.equal(team.score,-100);
  const late=joinMember(g,{name:'Alice',teamId:team.id});assert.notEqual(late.token,alice.token);
  assert.throws(()=>act(g,'buzz',{},'player',team.id),/already attempted/);
  act(g,'undo');assert(!g.members.some(m=>m.id===alice.id));assert(g.members.some(m=>m.id===late.id));assert(g.members.some(m=>m.id===bob.id));
  assert.throws(()=>act(g,'removePlayer',{memberId:bob.id},'player',team.id),/Host access/);
  act(g,'removePlayer',{memberId:bob.id});assert.equal(g.players.length,1);assert(!g.members.some(m=>m.id===bob.id));
});

test('legacy teams retain scores; member credentials and locked teams survive a restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'dibs-team-storage-'));
  try{
    const legacy=createGame({definition:{rounds:demoRounds()}}),team=addPlayer(legacy,'Old team');team.score=700;startReadyGame(legacy);
    const saved=JSON.parse(JSON.stringify(legacy));delete saved.members;delete saved.teamsLocked;
    writeFileSync(join(dir,'games.json'),JSON.stringify([saved]));
    const store=openGameStore(dir),restored=store.games.get(legacy.id)!;
    assert.equal(restored.players[0].score,700);assert(restored.teamsLocked);assert.deepEqual(restored.members,[]);
    const member=joinMember(restored,{name:'Alice',teamId:team.id});member.connected=true;store.save(restored);
    const again=openGameStore(dir).games.get(legacy.id)!;
    assert(again.teamsLocked);assert(!again.members[0].connected);assert.equal(again.members[0].token,member.token);
    assert.equal(joinMember(again,{token:member.token}).id,member.id);assert.equal(again.players[0].score,700);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

const emit=(socket:Socket,event:string,data:unknown)=>new Promise<{ok:boolean;error?:string}>((resolve,reject)=>socket.timeout(3000).emit(event,data,(error:Error|null,result:{ok:boolean;error?:string})=>error?reject(error):resolve(result)));
const event=(socket:Socket,name:string)=>new Promise<any>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(`No ${name} event`)),3000);socket.once(name,data=>{clearTimeout(timeout);resolve(data);});});
test('real phones reconnect individually; leaving and host removal revoke only that player and preserve the team', {timeout:15000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dibs-team-clients-'));let server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});const sockets:Socket[]=[];
  try{
    let base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
    const post=async(path:string,data:unknown)=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return{status:response.status,...await response.json()};};
    const created=await post('/api/games',{definition:{rounds:demoRounds(),settings:{earlyPenaltyMs:0}}});
    const connect=async(role:string,token?:string)=>{
      const socket=io(base,{autoConnect:false,transports:['websocket'],reconnection:false});sockets.push(socket);let state:GameView;
      socket.on('state',value=>state=value);const connected=event(socket,'connect');socket.connect();await connected;
      const subscription=await emit(socket,'subscribe',{gameId:created.id,role,token});return{socket,subscription,state:()=>state!};
    };
    const host=await connect('host'),command=(action:string,data?:unknown)=>emit(host.socket,'command',{action,data});
    assert.equal((await post(`/api/games/${created.id}/join`,{name:'Player-created team'})).status,400);
    assert((await command('addTeam',{name:'Red'})).ok);assert((await command('addTeam',{name:'Blue'})).ok);
    const teamId=host.state().players[0].id;
    const alice=await post(`/api/games/${created.id}/join`,{name:'Alice',teamId}),bob=await post(`/api/games/${created.id}/join`,{name:'Bob',teamId});
    const a=await connect('player',alice.token),b=await connect('player',bob.token);
    assert(a.subscription.ok&&b.subscription.ok);assert.notEqual(a.state().selfMemberId,b.state().selfMemberId);assert.equal(a.state().selfId,b.state().selfId);
    assert.equal((await connect('player',server.games.get(created.id)!.players[0].token)).subscription.ok,false);
    markTeamsReady(server.games.get(created.id)!);assert((await command('start')).ok);assert.equal((await command('addTeam',{name:'Late'})).ok,false);assert.equal((await command('removeTeam',{playerId:teamId})).ok,false);
    await command('adjust',{playerId:teamId,amount:900,mode:'set'});
    const disconnected=event(host.socket,'state');a.socket.disconnect();await disconnected;
    assert(server.games.get(created.id)!.players[0].connected); // Bob's phone remains connected.
    const reconnected=await connect('player',alice.token);assert(reconnected.subscription.ok);assert.equal(reconnected.state().selfMemberId,alice.memberId);
    const bobRevoked=event(b.socket,'revoked');assert((await command('removePlayer',{memberId:bob.memberId})).ok);await bobRevoked;
    assert.equal((await emit(b.socket,'command',{action:'buzz'})).ok,false);
    assert.equal((await connect('player',bob.token)).subscription.ok,false);
    assert.equal(server.games.get(created.id)!.members.length,1);assert.equal(host.state().players[0].score,900);
    await command('undo');assert(!server.games.get(created.id)!.members.some(m=>m.id===bob.memberId));
    const left=event(reconnected.socket,'revoked');assert((await emit(reconnected.socket,'command',{action:'leaveGame',data:{memberId:bob.memberId}})).ok);await left;
    assert.equal(server.games.get(created.id)!.members.length,0);assert.equal(host.state().players.length,2);
    assert.equal((await connect('player',alice.token)).subscription.ok,false);
    const fresh=await post(`/api/games/${created.id}/join`,{name:'Alice',teamId});assert.equal(fresh.status,200);assert.notEqual(fresh.token,alice.token);
    const c=await connect('player',fresh.token);assert(c.subscription.ok);
    for(const snapshot of [host.state(),c.state()])for(const token of [alice.token,bob.token,fresh.token])assert(!JSON.stringify(snapshot).includes(token));
    sockets.forEach(socket=>socket.disconnect());await server.close();server=await startServer({port:0,dataDir:dir,dev:false,quiet:true});base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
    const restored=await connect('player',fresh.token);assert(restored.subscription.ok);assert.equal(restored.state().selfMemberId,fresh.memberId);assert(restored.state().teamsLocked);assert.equal(restored.state().players.length,2);
    assert.equal((await connect('player',bob.token)).subscription.ok,false);
  }finally{sockets.forEach(socket=>socket.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});

test('every team must be ready, including imported games that previously disabled readiness',()=>{
  const g=createGame({definition:{rounds:demoRounds(),settings:{requireReady:false}}});
  assert(!('requireReady' in g.settings));
  const red=addPlayer(g,'Red'),blue=addPlayer(g,'Blue');
  const rejectStart=()=>{
    const before=structuredClone(g);
    for(const action of ['start','round','resume']){
      assert.throws(()=>act(g,action,{index:0}),/all teams are ready/);
      assert.deepEqual(g,before);
    }
  };
  rejectStart();act(g,'ready',{ready:true},'player',red.id);rejectStart();
  act(g,'ready',{ready:true},'player',blue.id);
  act(g,'ready',{ready:false},'player',red.id);rejectStart();
  act(g,'save',{settings:{requireReady:false}});assert(!('requireReady' in g.settings));rejectStart();
  act(g,'ready',{ready:true},'player',red.id);act(g,'start');assert.equal(g.status,'playing');
  assert.throws(()=>act(g,'ready',{ready:false},'player',red.id),/already started/);
});

test('host start is rejected over the socket until both teams mark themselves ready', {timeout:10000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dibs-ready-clients-')),server=await startServer({port:0,dataDir:dir,dev:false,quiet:true}),sockets:Socket[]=[];
  try{
    const game=createGame({definition:{rounds:demoRounds(),settings:{requireReady:false}}});server.games.set(game.id,game);
    const red=addPlayer(game,'Red'),blue=addPlayer(game,'Blue');
    const alice=joinMember(game,{teamId:red.id,name:'Alice'}),bob=joinMember(game,{teamId:blue.id,name:'Bob'});
    const base=`http://127.0.0.1:${(server.server.address()as{port:number}).port}`;
    const connect=async(role:string,token?:string)=>{
      const socket=io(base,{autoConnect:false,transports:['websocket'],reconnection:false});sockets.push(socket);
      const connected=event(socket,'connect');socket.connect();await connected;
      assert((await emit(socket,'subscribe',{gameId:game.id,role,token})).ok);return socket;
    };
    const host=await connect('host'),a=await connect('player',alice.token),b=await connect('player',bob.token);
    const start=()=>emit(host,'command',{action:'start'});
    assert.equal((await start()).ok,false);assert.equal(game.status,'lobby');
    assert((await emit(a,'command',{action:'ready',data:{ready:true}})).ok);
    assert.equal((await start()).ok,false);assert.equal(game.status,'lobby');
    assert((await emit(b,'command',{action:'ready',data:{ready:true}})).ok);
    assert((await start()).ok);assert.equal(game.status,'playing');
  }finally{sockets.forEach(socket=>socket.disconnect());await server.close();rmSync(dir,{recursive:true,force:true});}
});

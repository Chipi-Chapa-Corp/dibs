import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {io,Socket} from 'socket.io-client';
import type {GameView} from '../shared/model.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
async function freePort(){
 const probe=createServer();
 await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
 const port=(probe.address() as {port:number}).port;
 await new Promise<void>(resolve=>probe.close(()=>resolve()));
 return port;
}
const command=(socket:Socket,action:string,data:unknown)=>new Promise<void>((resolve,reject)=>{
 socket.timeout(3000).emit('command',{action,data},(error:Error,result:{ok:boolean;error?:string})=>{
  if(error||!result?.ok)reject(error||new Error(result?.error));else resolve();
 });
});

test('dev watcher reloads backend, shared code and config while CSS uses HMR and clients recover', {timeout:30000},async()=>{
 const fixture=mkdtempSync(join(tmpdir(),'dibs-dev-'));
 for(const file of ['package.json','vite.config.ts','tsconfig.json','index.html','server','shared','scripts'])cpSync(join(root,file),join(fixture,file),{recursive:true});
 symlinkSync(join(root,'node_modules'),join(fixture,'node_modules'),'dir');
 mkdirSync(join(fixture,'src'));
 writeFileSync(join(fixture,'src/main.tsx'),"import './style.css';\n");
 writeFileSync(join(fixture,'src/style.css'),'body{color:red}\n');
 const configPath=join(fixture,'vite.config.ts');
 writeFileSync(configPath,readFileSync(configPath,'utf8').replace('plugins: [react()],',"plugins: [react()],\n  cacheDir: '.vite',").replace("host: '0.0.0.0',","host: '0.0.0.0', headers: { 'X-Dev-Config-Probe': 'before' },"));
 const port=await freePort(),base=`http://127.0.0.1:${port}`;
 const child=spawn('npm',['run','dev'],{cwd:fixture,env:{...process.env,NODE_ENV:'development',PORT:String(port),DATA_DIR:join(fixture,'data')},detached:true,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 const sockets:Socket[]=[];let hmr:WebSocket|undefined;
 const until=async(check:()=>boolean|Promise<boolean>,message:string)=>{
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){try{if(await check())return;}catch{}await delay(50);}
  throw new Error(`${message}\n${output}`);
 };
 const request=async(path:string,data?:unknown)=>{
  const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(1000)});
  assert(response.ok);return response.json();
 };
 const connect=(role:string,gameId:string,token:string)=>{
  const socket=io(base,{autoConnect:false,transports:['websocket'],reconnectionDelay:50,reconnectionDelayMax:100,randomizationFactor:0});sockets.push(socket);
  let subscriptions=0,state:GameView|undefined;
  socket.on('state',(value:GameView)=>state=value);
  socket.on('connect',()=>socket.emit('subscribe',{gameId,role,token},(result:{ok:boolean})=>{if(result.ok)subscriptions++;}));
  socket.connect();
  return {socket,state:()=>state,subscriptions:()=>subscriptions};
 };
 try{
  await until(async()=>!!(await request('/api/health')).ok,'Dev server did not start');
  const game=await request('/api/games',{name:'Reload persistence'});
  const player=await request(`/api/games/${game.id}/join`,{name:'Ada'});
  const host=connect('host',game.id,game.hostToken),phone=connect('player',game.id,player.token);
  await until(()=>host.subscriptions()===1&&phone.subscriptions()===1,'Clients did not subscribe');
  await command(host.socket,'adjust',{playerId:player.playerId,mode:'set',amount:450});
  await until(()=>phone.state()?.players[0]?.score===450,'Score did not synchronize');

  const savedFile=join(fixture,'data','games',`${game.id}.json`);
  await until(()=>existsSync(savedFile),'Per-game save did not appear');
  for(const route of [`/data/games/${game.id}.json`,`/@fs${savedFile}`]){
   const response=await fetch(base+route),body=await response.text();
   assert.equal(response.status,403);assert(!body.includes(game.hostToken));
  }

  await fetch(base+'/src/main.tsx');await fetch(base+'/src/style.css');
  const messages:{type:string}[]=[];
  hmr=new WebSocket(`ws://127.0.0.1:${port}/`,'vite-hmr');
  hmr.addEventListener('message',event=>messages.push(JSON.parse(String(event.data))));
  await until(()=>messages.some(m=>m.type==='connected'),'Vite HMR did not connect');
  writeFileSync(join(fixture,'src/style.css'),'body{color:blue;--hot-reload-probe:updated}\n');
  await until(()=>messages.some(m=>m.type==='update'),'CSS change did not send an HMR update');
  assert((await (await fetch(base+'/src/style.css')).text()).includes('--hot-reload-probe:updated'));
  assert.equal(host.subscriptions(),1);assert.equal(phone.subscriptions(),1);

  const enginePath=join(fixture,'server/engine.ts');
  writeFileSync(enginePath+'.next',readFileSync(enginePath,'utf8').replaceAll("'Untitled game'","'Reloaded game'"));renameSync(enginePath+'.next',enginePath);
  await until(()=>host.subscriptions()>1&&phone.subscriptions()>1,'Backend edit did not restart and reconnect clients');
  assert.equal(phone.state()?.players[0]?.score,450);assert.equal(phone.state()?.selfId,player.playerId);
  const next=await request('/api/games',{});
  assert.equal((await request(`/api/games/${next.id}`)).name,'Reloaded game');

  const sharedPath=join(fixture,'shared/model.ts'),beforeShared=host.subscriptions();
  writeFileSync(sharedPath,readFileSync(sharedPath,'utf8').replace('startingScore:0','startingScore:25'));
  await until(()=>host.subscriptions()>beforeShared,'Shared code edit did not restart the backend');
  const changed=await request('/api/games',{});await request(`/api/games/${changed.id}/join`,{name:'Bea'});
  assert.equal((await request(`/api/games/${changed.id}`)).players[0].score,25);

  const workingEngine=readFileSync(enginePath,'utf8'),beforeError=host.subscriptions();
  writeFileSync(enginePath,'const broken = ;\n'+workingEngine);
  await until(()=>!host.socket.connected,'Invalid server code did not stop the old process');
  await until(()=>output.includes('Server stopped. Save a source file'),'Watcher did not survive the server error');
  writeFileSync(enginePath,workingEngine);
  await until(()=>host.subscriptions()>beforeError&&phone.socket.connected,'Fixing server code did not recover the server');
  assert.equal(host.state()?.players[0].score,450);

  const beforeConfig=host.subscriptions();
  writeFileSync(configPath,readFileSync(configPath,'utf8').replace("'X-Dev-Config-Probe': 'before'","'X-Dev-Config-Probe': 'after'"));
  await until(()=>host.subscriptions()>beforeConfig,'Vite config edit did not restart the backend');
  await until(async()=>(await fetch(base+'/src/main.tsx')).headers.get('X-Dev-Config-Probe')==='after','New Vite config was not applied');
  assert.equal(host.state()?.players[0].score,450);
  assert(!output.includes('Force killing'));assert(!output.includes("Process didn't exit"));assert(!output.includes('shutdown timed out'));
 }finally{
  sockets.forEach(socket=>socket.disconnect());hmr?.close();
  if(child.exitCode===null&&child.signalCode===null&&child.pid){
   process.kill(-child.pid,'SIGTERM');
   const force=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},4000).unref();
   await exited;clearTimeout(force);
  }
  rmSync(fixture,{recursive:true,force:true});
 }
});

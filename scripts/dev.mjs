import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const sourceExtensions=/\.(?:[cm]?[jt]sx?|json)$/;
// Content polling detects atomic saves and changes on synced filesystems.
async function fingerprint(){
  const hash=createHash('sha256');
  async function visit(relative){
    const path=join(root,relative);
    try{
      const contents=await readdir(path,{withFileTypes:true});
      for(const entry of contents.sort((a,b)=>a.name.localeCompare(b.name))){
        if(entry.isDirectory()||sourceExtensions.test(entry.name))await visit(join(relative,entry.name));
      }
    }catch(error){
      if(error.code==='ENOENT')return;
      if(error.code!=='ENOTDIR')throw error;
      try{hash.update(relative).update('\0').update(await readFile(path)).update('\0');}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
  }
  for(const path of ['server','shared','vite.config.ts','tsconfig.json','package.json'])await visit(path);
  return hash.digest('hex');
}

let child,childStop,checking=false,restarting=false,restartRequested=false,stopping=false,restartTimer;
function startChild(){
  childStop=undefined;
  child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:root,env:{...process.env,NODE_ENV:'development'},stdio:'inherit'});
  child.on('error',error=>console.error('[dev] Could not start the server:',error));
  child.on('exit',code=>{
    if(!stopping&&!restarting&&code!==0)console.error('[dev] Server stopped. Save a source file to try again.');
  });
}
function stopChild(){
  if(childStop)return childStop;
  if(!child||child.exitCode!==null||child.signalCode!==null)return Promise.resolve();
  const active=child;
  childStop=new Promise(resolve=>{
    const deadline=setTimeout(()=>{
      console.error('[dev] Server shutdown timed out; terminating it.');
      active.kill('SIGKILL');
    },3000).unref();
    active.once('exit',()=>{clearTimeout(deadline);resolve();});
    active.kill('SIGTERM');
  });
  return childStop;
}
async function restart(){
  restartRequested=true;
  if(restarting)return;
  restarting=true;
  try{
    while(restartRequested&&!stopping){
      restartRequested=false;
      console.log('[dev] Server source changed. Restarting…');
      await stopChild();
      if(!stopping)startChild();
    }
  }finally{restarting=false;}
}

let previous=await fingerprint();
startChild();
const watcher=setInterval(async()=>{
  if(checking||stopping)return;
  checking=true;
  try{
    const current=await fingerprint();
    if(current!==previous&&!stopping){
      previous=current;
      clearTimeout(restartTimer);
      restartTimer=setTimeout(()=>void restart(),100);
    }
  }catch(error){console.error('[dev] Could not check source files:',error);}
  finally{checking=false;}
},200);
async function shutdown(){
  if(stopping)return;
  stopping=true;
  clearInterval(watcher);
  clearTimeout(restartTimer);
  await stopChild();
  process.exit(0);
}
process.on('SIGINT',()=>void shutdown());
process.on('SIGTERM',()=>void shutdown());

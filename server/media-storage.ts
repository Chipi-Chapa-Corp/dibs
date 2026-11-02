import fs from 'node:fs';
import path from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {StorageEngine} from 'multer';
import {token} from './engine.ts';

/** Count bytes before writing them, including simultaneous and chunked uploads. */
export function mediaStorage(directory:string,capacity:number,extensions:Record<string,string>):StorageEngine{
  let used=fs.readdirSync(directory,{withFileTypes:true}).filter(f=>f.isFile()).reduce((sum,f)=>sum+fs.statSync(path.join(directory,f.name)).size,0);
  return{
    _handleFile(req,file,callback){
      const filename=token()+extensions[file.mimetype],destination=path.join(directory,filename);
      let size=0,created=false;const controller=new AbortController();
      const abort=()=>controller.abort();req.once('aborted',abort);
      const budget=new Transform({transform(chunk:Buffer,_encoding,done){
        if(used+chunk.length>capacity){done(Object.assign(new Error('Media storage limit reached.'),{status:507}));return;}
        used+=chunk.length;size+=chunk.length;done(null,chunk);
      }});
      const write=async()=>{
        // Finish opening before streaming: a fast quota rejection must not unlink
        // a not-yet-opened file which the pending open would then recreate.
        const handle=await fs.promises.open(destination,'wx',0o600);created=true;
        try{await pipeline(file.stream,budget,handle.createWriteStream(),{signal:controller.signal});}
        finally{await handle.close().catch(()=>{});}
      };
      void write().then(
        ()=>{req.off('aborted',abort);callback(null,{destination:directory,filename,path:destination,size});},
        async error=>{req.off('aborted',abort);if(created)try{await fs.promises.unlink(destination);}catch{}used-=size;callback(error);}
      );
    },
    _removeFile(_req,file,callback){
      fs.unlink(file.path,error=>{if(!error)used-=file.size;callback(error);});
    },
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,statSync} from 'node:fs';
import {tmpdir,networkInterfaces} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest,type IncomingMessage} from 'node:http';
import {io} from 'socket.io-client';
import {localNetwork,RateLimits} from '../server/security.ts';
import {startServer} from '../server/index.ts';

const nic=(address:string,netmask='255.255.255.0')=>({address,netmask,family:'IPv4' as const,internal:false,mac:'00:00:00:00:00:00',cidr:null});
test('LAN policy admits only loopback and the selected physical subnet, rejecting VPNs, IPv6 and forwarded IP claims',()=>{
  const policy=localNetwork({en0:[nic('192.168.1.124')],en1:[nic('10.0.0.2')],utun0:[nic('172.16.0.2')]});
  for(const ip of ['127.0.0.1','::ffff:127.0.0.1','192.168.1.50'])assert(policy.allowsPeer(ip));
  for(const ip of ['192.168.2.1','10.0.0.3','172.16.0.3','8.8.8.8','2001:db8::1','::1'])assert(!policy.allowsPeer(ip));
  assert(!localNetwork({utun0:[nic('10.0.0.2')]}).allowsPeer('10.0.0.3'));
  assert(localNetwork({en0:[nic('192.168.1.124')],en1:[nic('10.0.0.2')]},'en1').allowsPeer('10.0.0.3'));
  assert.throws(()=>localNetwork({},'missing'));
  const req=(ip:string,host='localhost:43187',origin?:string)=>({socket:{remoteAddress:ip},headers:{host,origin,'x-forwarded-for':'127.0.0.1'}} as unknown as IncomingMessage);
  assert(policy.accepts(req('127.0.0.1'),43187));
  assert(policy.accepts(req('192.168.1.50','192.168.1.124:43187','http://192.168.1.124:43187'),43187));
  assert(!policy.accepts(req('8.8.8.8'),43187));
  assert(!policy.accepts(req('127.0.0.1','evil.test:43187'),43187));
  assert(!policy.accepts(req('127.0.0.1','localhost:43187','https://evil.test'),43187));
  assert(!policy.accepts(req('127.0.0.1','localhost:43187','null'),43187));
  assert(!policy.accepts(req('127.0.0.1','localhost:43187','http://localhost:8888'),43187));
});

test('rate windows recover, isolate callers and bound their memory',()=>{
  const limits=new RateLimits();
  assert(limits.take('one',2,1000,0));assert(limits.take('one',2,1000,1));assert(!limits.take('one',2,1000,2));
  assert(limits.take('two',1,1000,2));assert(limits.take('one',2,1000,1000));
  const bounded=new RateLimits();for(let i=0;i<4096;i++)assert(bounded.take(String(i),1,10,0));
  assert(!bounded.take('overflow',1,10,1));assert(bounded.take('after-expiry',1,10,11));
});

async function fixture(limits?:{maxGames?:number;mediaBytes?:number;fileBytes?:number}){
  const dir=mkdtempSync(join(tmpdir(),'dibs-security-')),mediaDir=join(dir,'media');
  const instance=await startServer({port:0,dataDir:dir,mediaDir,limits,dev:false,quiet:true});
  const port=(instance.server.address()as{port:number}).port,base=`http://127.0.0.1:${port}`;
  const post=async(path:string,data:unknown,headers:Record<string,string>={},origin=base)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  const create=async()=>(await (await post('/api/games',{name:'Security fixture'})).json());
  return{dir,mediaDir,instance,base,port,post,create,close:async()=>{await instance.close();rmSync(dir,{recursive:true,force:true});}};
}

test('HTTP and WebSocket origin guards block unrelated websites while normal LAN participants retain public game access',async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.post('/api/games',{}, {Origin:'https://evil.test'})).status,403);
    const hostileHost=await new Promise<number>((resolve,reject)=>{
      const req=httpRequest(f.base+'/api/games',{headers:{Host:`evil.test:${f.port}`}},res=>{res.resume();resolve(res.statusCode!);});req.on('error',reject);req.end();
    });
    assert.equal(hostileHost,403);
    assert.equal((await fetch(f.base+'/api/games',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
    const socket=io(f.base,{transports:['websocket'],autoConnect:false,reconnection:false,timeout:1000,extraHeaders:{Origin:'https://evil.test'}});
    try{await new Promise<void>((resolve,reject)=>{socket.once('connect',()=>reject(Error('Cross-origin WebSocket was admitted')));socket.once('connect_error',()=>resolve());socket.connect();});}finally{socket.disconnect();}
    const created=await f.create();
    const lan=localNetwork(networkInterfaces()).lan;
    if(lan){
      const remote=`http://${lan.address}:${f.port}`;
      assert.equal((await f.post('/api/games',{}, {},remote)).status,201);
      assert.equal((await f.post('/api/games',{}, {'X-Forwarded-For':'127.0.0.1'},remote)).status,201);
      assert.equal((await fetch(`${remote}/api/games/${created.id}/export`)).status,200);
      assert.equal((await f.post(`/api/games/${created.id}/join`,{name:'Phone'}, {},remote)).status,200);
    }
    assert.equal((await fetch(f.base+'/api/games')).headers.get('x-frame-options'),'DENY');
  }finally{await f.close();}
});

test('game and API limits reject excess requests without losing existing games',async()=>{
  const f=await fixture({maxGames:2});
  try{
    const first=await f.create(),second=await f.create();
    assert.equal((await f.post('/api/games',{})).status,409);
    assert.equal((await fetch(`${f.base}/api/games/${second.id}`,{method:'DELETE'})).status,200);
    assert.equal((await f.post('/api/games',{})).status,201);
    let limited=false;
    for(let i=0;i<125;i++)if((await f.post(`/api/games/${first.id}/join`,{name:`P${i}`})).status===429){limited=true;break;}
    assert(limited);assert(f.instance.games.has(first.id));
    for(let i=0;i<305;i++){const res=await fetch(f.base+'/api/health');if(res.status===429){assert.equal(res.headers.get('Retry-After'),'60');return;}}
    assert.fail('API requests were not limited');
  }finally{await f.close();}
});

test('streaming media budgets handle concurrent uploads and remove oversized/failed files',async()=>{
  const f=await fixture({fileBytes:100,mediaBytes:150});let editor:ReturnType<typeof io>|undefined;
  try{
    const g=await f.create();
    const socket=io(f.base,{transports:['websocket'],autoConnect:false});editor=socket;
    await new Promise<void>(resolve=>{socket.once('connect',()=>resolve());socket.connect();});
    await new Promise<void>((resolve,reject)=>socket.emit('subscribe',{gameId:g.id,role:'host',editing:true},(r:{ok:boolean})=>r.ok?resolve():reject(Error('No editor lock'))));
    const upload=(size:number,editorId=editor!.id!)=>{const data=new FormData();data.append('file',new Blob([new Uint8Array(size)],{type:'image/png'}),'test.png');return fetch(`${f.base}/api/games/${g.id}/media`,{method:'POST',headers:{'X-Editor-Id':editorId},body:data});};
    assert.equal((await upload(50,'wrong')).status,409);
    assert.equal((await upload(101)).status,413);assert.deepEqual(readdirSync(f.mediaDir),[]);
    const results=await Promise.all([upload(90),upload(90)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,507]);
    const successful=await results.find(r=>r.status===200)!.json();
    assert.equal((await fetch(f.base+successful.url)).status,200);
    const multipartHeader='--budget-test\r\nContent-Disposition: form-data; name="file"; filename="chunk.png"\r\nContent-Type: image/png\r\n\r\n';
    const rawUpload=()=>httpRequest(`${f.base}/api/games/${g.id}/media`,{method:'POST',headers:{'X-Editor-Id':editor!.id!,'Content-Type':'multipart/form-data; boundary=budget-test'}});
    const chunked=await new Promise<number>((resolve,reject)=>{
      const req=rawUpload();req.on('response',res=>{res.resume();resolve(res.statusCode!);});req.on('error',reject);
      req.write(multipartHeader);req.write(Buffer.alloc(80));req.end('\r\n--budget-test--\r\n');
    });
    assert.equal(chunked,507);assert.equal(readdirSync(f.mediaDir).length,1);
    const waitFor=async(check:()=>boolean)=>{const deadline=Date.now()+2000;while(!check()){assert(Date.now()<deadline,'Aborted upload was not cleaned up');await new Promise(resolve=>setTimeout(resolve,10));}};
    const aborted=rawUpload();aborted.on('error',()=>{});aborted.write(multipartHeader);aborted.write(Buffer.alloc(40));
    await waitFor(()=>readdirSync(f.mediaDir).length===2);aborted.destroy();
    await waitFor(()=>readdirSync(f.mediaDir).length===1);
    assert.equal((await upload(40)).status,200);
    assert.equal(readdirSync(f.mediaDir).reduce((sum,name)=>sum+statSync(join(f.mediaDir,name)).size,0),130);
    assert.equal((await upload(30)).status,507);
    assert.equal(readdirSync(f.mediaDir).length,2);
  }finally{editor?.disconnect();await f.close();}
});

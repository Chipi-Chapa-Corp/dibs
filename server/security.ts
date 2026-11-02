import {BlockList,isIPv4} from 'node:net';
import os from 'node:os';
import type {IncomingMessage} from 'node:http';

export const peerIP=(ip='')=>ip.startsWith('::ffff:')?ip.slice(7):ip;
export const isLoopback=(ip:string)=>ip==='::1'||/^127\./.test(peerIP(ip));
const privateIPv4=(ip:string)=>/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(ip);

export function localNetwork(interfaces=os.networkInterfaces(),selected=process.env.LAN_INTERFACE){
  const entries=Object.entries(interfaces).flatMap(([name,addresses])=>(addresses||[]).filter(a=>a.family==='IPv4'&&!a.internal&&privateIPv4(a.address)).map(a=>({...a,name})));
  const candidates=entries.filter(a=>! /^(utun|tun|tap|tailscale|docker|veth|br-)/.test(a.name));
  const lan=selected?entries.find(a=>a.name===selected):candidates.find(a=>a.name==='en0')||candidates[0];
  if(selected&&!lan)throw Error(`LAN_INTERFACE ${selected} has no private IPv4 address`);
  const allowed=new BlockList();allowed.addSubnet('127.0.0.0',8,'ipv4');
  if(lan){
    const bits=lan.netmask.split('.').map(n=>Number(n).toString(2).padStart(8,'0')).join('');
    if(!/^1+0*$/.test(bits)||bits.indexOf('0')===0)throw Error('Invalid LAN subnet mask');
    allowed.addSubnet(lan.address,bits.replace(/0/g,'').length,'ipv4');
  }
  const hosts=new Set(['localhost','127.0.0.1',...(lan?[lan.address]:[])]);
  return{lan,allowsPeer:(ip:string)=>{const v=peerIP(ip);return isIPv4(v)&&(isLoopback(v)||privateIPv4(v)&&allowed.check(v,'ipv4'));},
    accepts(req:IncomingMessage,port:number){
      if(!this.allowsPeer(req.socket.remoteAddress||''))return false;
      try{
        const host=new URL(`http://${req.headers.host}`);
        if(!hosts.has(host.hostname)||host.port!==String(port)||host.host!==req.headers.host||host.username||host.password||host.pathname!=='/')return false;
        if(req.headers.origin&&req.headers.origin!==host.origin)return false;
        return true;
      }catch{return false;}
    }};
}

/** Fixed windows with bounded memory; reject new keys when capacity is exhausted. */
export class RateLimits {
  private entries=new Map<string,{count:number;until:number}>();
  take(key:string,max:number,windowMs:number,now=Date.now()){
    let entry=this.entries.get(key);
    if(entry&&entry.until<=now){this.entries.delete(key);entry=undefined;}
    if(!entry){
      if(this.entries.size>=4096){for(const[k,v]of this.entries)if(v.until<=now)this.entries.delete(k);}
      if(this.entries.size>=4096)return false;
      entry={count:0,until:now+windowMs};this.entries.set(key,entry);
    }
    return ++entry.count<=max;
  }
}

import {realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

if(process.platform!=='darwin')throw Error('This helper is for the macOS application firewall.');
const firewall='/usr/libexec/ApplicationFirewall/socketfilterfw';
const node=realpathSync(process.execPath);
const steps=[['--add',node],['--unblockapp',node],['--setglobalstate','on'],['--getglobalstate'],['--getappblocked',node]];
if(process.argv.includes('--print')){
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  for(const args of steps)console.log(['sudo',firewall,...args].map(quote).join(' '));
}else{
  console.log('Allowing this Node executable, then enabling the macOS firewall. macOS may ask for your administrator password.');
  for(const args of steps){
    const result=spawnSync('sudo',[firewall,...args],{stdio:'inherit'});
    if(result.error)throw result.error;
    if(result.status!==0)process.exit(result.status||1);
  }
}

import { spawnSync } from 'node:child_process';

const script = `const fs=require('node:fs');const crypto=require('node:crypto');const cp=require('node:child_process');
const files=['/opt/baci/primary-paid-interest/interest-inbox.cjs','/opt/baci/primary-paid-interest/manifest.json','/etc/baci/primary-paid-interest.env','/etc/systemd/system/baci-primary-paid-interest.service','/etc/systemd/system/baci-primary-paid-interest.timer'];
const paths={};for(const file of files){try{const stat=fs.lstatSync(file);const item={state:'present',regular:stat.isFile(),uid:stat.uid,gid:stat.gid,mode:stat.mode&511};
if(file!='/etc/baci/primary-paid-interest.env'&&stat.isFile()&&stat.size<=16777216)item.sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');paths[file]=item;
}catch(error){paths[file]={state:error.code==='ENOENT'?'absent':'unreadable'};}}
const account=cp.spawnSync('getent',['passwd','baci-primary-interest-inbox'],{encoding:'utf8'});
const units={};for(const unit of ['baci-primary-paid-interest.service','baci-primary-paid-interest.timer']){const observed=cp.spawnSync('systemctl',['show',unit,'--property=LoadState,ActiveState,SubState,FragmentPath','--no-pager'],{encoding:'utf8'});const metadata={};for(const line of (observed.stdout||'').split('\\n')){const split=line.indexOf('=');const key=line.slice(0,split);if(['LoadState','ActiveState','SubState','FragmentPath'].includes(key))metadata[key]=line.slice(split+1);}units[unit]=typeof metadata.LoadState==='string'?metadata:{state:'unavailable'};}
process.stdout.write(JSON.stringify({nodeMajor:Number(process.versions.node.split('.')[0]),accountPresent:account.status===0,paths,units}));`;

export function collectPrimaryInterestHostInventory(input = {}) {
  const run = input.run ?? spawnSync;
  const result = run('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12',
    'bassey@82.29.190.219', '/usr/bin/node -'], { input: script, encoding: 'utf8', timeout: 20000, maxBuffer: 65536 });
  if (result.status !== 0) throw new Error('Read-only interest host inventory unavailable');
  let observed;
  try { observed = JSON.parse(result.stdout); } catch { throw new Error('Read-only interest host inventory unavailable'); }
  if (Object.keys(observed).some((key) => !['nodeMajor','accountPresent','paths','units'].includes(key)) ||
    !Number.isInteger(observed.nodeMajor) || typeof observed.accountPresent !== 'boolean' || !observed.paths || !observed.units)
    throw new Error('Read-only interest host inventory unavailable');
  const allowedPaths = ['/opt/baci/primary-paid-interest/interest-inbox.cjs','/opt/baci/primary-paid-interest/manifest.json',
    '/etc/baci/primary-paid-interest.env','/etc/systemd/system/baci-primary-paid-interest.service','/etc/systemd/system/baci-primary-paid-interest.timer'];
  for (const [filename,item] of Object.entries(observed.paths)) {
    if (!allowedPaths.includes(filename) || Object.keys(item).some((key) => !['state','regular','uid','gid','mode','sha256'].includes(key)) ||
      !['present','absent','unreadable'].includes(item.state) || (item.sha256!==undefined && !/^[a-f0-9]{64}$/.test(item.sha256)))
      throw new Error('Read-only interest host inventory unavailable');
  }
  for (const [unit,item] of Object.entries(observed.units)) {
    if (!['baci-primary-paid-interest.service','baci-primary-paid-interest.timer'].includes(unit) ||
      Object.entries(item).some(([key,value]) => !['LoadState','ActiveState','SubState','FragmentPath','state'].includes(key) || typeof value!=='string' || value.length>512))
      throw new Error('Read-only interest host inventory unavailable');
  }
  return { evidenceSource: 'authorized_host_metadata', host: 'bassey@82.29.190.219',
    capturedAt: (input.now ?? (() => new Date()))().toISOString(), ...observed,
    databaseInspected: false, configurationValuesInspected: false, activationAuthorized: false };
}

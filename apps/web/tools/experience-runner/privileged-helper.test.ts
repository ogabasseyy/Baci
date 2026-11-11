import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { makeOCISpec } from './oci-policy';

const helper = fileURLToPath(
  new URL('./privileged-helper.py', import.meta.url)
);
const root = '/var/tmp/baci-experience-checkpoint-a';
const jobs = {
  compile: ['node24', 'compile-runtime.mjs', true],
  prerender: ['node24', 'prerender-worker.mjs', true],
  'prerender-build': ['node24', 'prerender-build-worker.mjs', true],
  capture: ['browser', 'capture-worker.mjs', false],
  performance: ['browser', 'performance-worker.mjs', false],
  checks: ['browser', 'browser-checks.mjs', false],
  'prerender-checks': ['browser', 'prerender-browser-worker.mjs', false],
  'prerender-private-checks': [
    'browser',
    'private-preview-browser-worker.mjs',
    false,
  ],
  'durable-public-checks': ['browser', 'public-browser-worker.mjs', false],
} as const;

it('reconstructs each fixed sandbox policy independently of caller input', () => {
  for (const [kind, [image, worker, build]] of Object.entries(jobs)) {
    const expected = makeOCISpec(
      `${root}/${image}/rootfs`,
      ['/usr/local/bin/node', `/opt/experience/${worker}`],
      build ? 'build' : 'capture'
    );
    if (!build)
      expected.process.env.push(
        'HOME=/tmp',
        'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright'
      );
    const actual = JSON.parse(
      execFileSync('python3', ['-I', helper, 'policy', kind], {
        encoding: 'utf8',
      })
    );
    expect(actual).toEqual(expected);
  }
});

it('rejects unknown job kinds and arguments', () => {
  for (const args of [
    ['policy', 'shell'],
    ['policy', 'compile', '/etc'],
    ['prepare', '../escape'],
  ]) {
    expect(() =>
      execFileSync('python3', ['-I', helper, ...args], { stdio: 'ignore' })
    ).toThrow();
  }
});

it('creates only a new UUID-named bundle with the fixed policy', () => {
  const script = `
import importlib.util,json,os,tempfile
spec=importlib.util.spec_from_file_location('helper', __import__('sys').argv[1]); h=importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
with tempfile.TemporaryDirectory() as d:
 fd=os.open(d,os.O_RDONLY | os.O_DIRECTORY)
 try:
  name='baci-experience-12345678-1234-4234-8234-123456789abc'
  h.prepare_job(fd, 'compile', name)
  data=json.load(open(os.path.join(d,name,'config.json')))
  expected=h.policy('compile');expected['linux']['cgroupsPath']='/baci-experience-checkpoint-a/'+name
  assert data==expected
  for kind,job in [('compile',name),('bad','baci-experience-12345678-1234-4234-8234-123456789abd'),('compile','../escape')]:
   try: h.prepare_job(fd,kind,job)
   except (ValueError,FileExistsError): pass
   else: raise AssertionError('invalid job accepted')
 finally: os.close(fd)
`;
  execFileSync('python3', ['-I', '-c', script, helper], { stdio: 'pipe' });
});

it('rejects symlinked, writable, or unowned job directories', () => {
  const script = `
import importlib.util,os,tempfile
spec=importlib.util.spec_from_file_location('helper', __import__('sys').argv[1]); h=importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
with tempfile.TemporaryDirectory() as d:
 fd=os.open(d,os.O_RDONLY|os.O_DIRECTORY)
 try:
  os.mkdir('safe',0o700,dir_fd=fd)
  child=h.open_trusted_child(fd,'safe',os.getuid());os.close(child)
  os.symlink('safe','link',dir_fd=fd)
  os.mkdir('writable',0o777,dir_fd=fd);os.chmod('writable',0o777,dir_fd=fd)
  for name,uid in [('link',os.getuid()),('writable',os.getuid()),('safe',os.getuid()+1),('../safe',os.getuid())]:
   try: child=h.open_trusted_child(fd,name,uid)
   except (ValueError,OSError): pass
   else: os.close(child);raise AssertionError('untrusted path accepted')
 finally: os.close(fd)
`;
  execFileSync('python3', ['-I', '-c', script, helper], { stdio: 'pipe' });
});

it('rejects a modified sandbox specification before execution', () => {
  const script = `
import importlib.util,json,os,tempfile
spec=importlib.util.spec_from_file_location('helper', __import__('sys').argv[1]); h=importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
with tempfile.TemporaryDirectory() as d:
 fd=os.open(d,os.O_RDONLY|os.O_DIRECTORY)
 try:
  name='baci-experience-12345678-1234-4234-8234-123456789abc'
  h.prepare_job(fd,'compile',name)
  h.verify_job(fd,name,os.getuid())
  path=os.path.join(d,name,'config.json');data=json.load(open(path));data['root']['readonly']=False
  with open(path,'w') as f:json.dump(data,f)
  try:h.verify_job(fd,name,os.getuid())
  except ValueError:pass
  else:raise AssertionError('modified policy accepted')
 finally:os.close(fd)
`;
  execFileSync('python3', ['-I', '-c', script, helper], { stdio: 'pipe' });
});

it('executes only the verified bundle with a fixed offline runsc command', () => {
  const script = `
import importlib.util,os,tempfile
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('helper', __import__('sys').argv[1]);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
with tempfile.TemporaryDirectory() as d:
 fd=os.open(d,os.O_RDONLY|os.O_DIRECTORY)
 try:
  name='baci-experience-12345678-1234-4234-8234-123456789abc';h.prepare_job(fd,'compile',name)
  with patch.object(h.os,'execve') as run:
   h.execute_job(fd,name,os.getuid())
   argv=run.call_args.args[1]
   assert argv==['/usr/local/bin/runsc','--root='+h.ROOT+'/state','--network=none','run','--bundle='+h.ROOT+'/jobs/'+name,name]
  try:h.execute_job(fd,'../bad',os.getuid())
  except ValueError:pass
  else:raise AssertionError('invalid job accepted')
 finally:os.close(fd)
`;
  execFileSync('python3', ['-I', '-c', script, helper], { stdio: 'pipe' });
});

it('retains a bundle if container deletion fails', () => {
  const script = `
import importlib.util,os,tempfile,subprocess
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('helper', __import__('sys').argv[1]);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
with tempfile.TemporaryDirectory() as d:
 fd=os.open(d,os.O_RDONLY|os.O_DIRECTORY)
 try:
  name='baci-experience-12345678-1234-4234-8234-123456789abc';h.prepare_job(fd,'compile',name)
  with patch.object(h.subprocess,'run',side_effect=subprocess.CalledProcessError(1,'runsc')):
   try:h.delete_job(fd,name,os.getuid())
   except subprocess.CalledProcessError:pass
   else:raise AssertionError('deletion failure suppressed')
  assert os.path.exists(os.path.join(d,name,'config.json'))
  with patch.object(h.subprocess,'run') as run:
   h.delete_job(fd,name,os.getuid())
   assert run.call_args.args[0]==['/usr/local/bin/runsc','--root='+h.ROOT+'/state','delete','--force',name]
  assert not os.path.exists(os.path.join(d,name))
 finally:os.close(fd)
`;
  execFileSync('python3', ['-I', '-c', script, helper], { stdio: 'pipe' });
});

it('requires root and strictly parses privileged operations', () => {
  const script = `
import importlib.util
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('helper', __import__('sys').argv[1]);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
name='baci-experience-12345678-1234-4234-8234-123456789abc'
with patch.object(h.os,'geteuid',return_value=1000),patch.object(h,'open_jobs') as opened:
 try:h.main(['prepare','compile',name])
 except ValueError:pass
 else:raise AssertionError('unprivileged call accepted')
 opened.assert_not_called()
with patch.object(h.os,'geteuid',return_value=0),patch.object(h,'open_jobs',return_value=99),patch.object(h.os,'close'),patch.object(h,'prepare_job') as prep:
 h.main(['prepare','compile',name]);prep.assert_called_once_with(99,'compile',name)
 for args in [['prepare','compile',name,'extra'],['run','../bad'],['delete',name,'extra'],['run','-x']]:
  try:h.main(args)
  except ValueError:pass
  else:raise AssertionError('invalid call accepted')
`;
  execFileSync('python3', ['-I', '-c', script, helper], { stdio: 'pipe' });
});

it('rejects replaceable preflight files and invokes only fixed verified executables', () => {
  const script = `
import importlib.util,os,tempfile
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('helper', __import__('sys').argv[1]);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
with tempfile.TemporaryDirectory() as d:
 fd=os.open(d,os.O_RDONLY|os.O_DIRECTORY)
 try:
  with open(os.path.join(d,'safe'),'w') as f:f.write('x')
  os.chmod('safe',0o755,dir_fd=fd);h.verify_trusted_file(fd,'safe',os.getuid())
  os.symlink('safe','link',dir_fd=fd)
  os.link('safe','hard',src_dir_fd=fd,dst_dir_fd=fd)
  for name in ['safe','link','../safe']:
   try:h.verify_trusted_file(fd,name,os.getuid())
   except (ValueError,OSError):pass
   else:raise AssertionError('unsafe file accepted')
 finally:os.close(fd)
with patch.object(h,'verify_preflight_files') as verify,patch.object(h.os,'execve') as run:
 h.run_preflight();verify.assert_called_once()
 assert run.call_args.args[0]=='/usr/local/libexec/baci-experience-node'
 assert run.call_args.args[1]==['/usr/local/libexec/baci-experience-node','/usr/local/libexec/baci-experience-preflight.mjs']
`;
  execFileSync('python3', ['-I', '-c', script, helper], { stdio: 'pipe' });
});

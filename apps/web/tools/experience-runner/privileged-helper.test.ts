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

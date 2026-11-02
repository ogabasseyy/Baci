import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const web = fileURLToPath(new URL('../../apps/web/', import.meta.url));

test('installed GIGL wrapper and Linux lock proofs use the real tsx loader', {
  skip: process.platform !== 'linux',
  timeout: 240000,
}, () => {
  const options = {
    cwd: web,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, GIGL_REAL_TSX_MODULES: `${web}node_modules` },
  };
  for (const name of [
    'gigl-worker-launch-linux-probe.py',
    'gigl-flock-linux-probe.py',
  ]) {
    execFileSync('python3', [`${repository}tools/test/${name}`], options);
  }
});

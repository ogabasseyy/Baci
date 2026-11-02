import { execFileSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const web = fileURLToPath(new URL('../../apps/web/', import.meta.url));

function findTsxModules(candidates) {
  return candidates.find((path) => {
    try {
      accessSync(join(path, '.bin/tsx'), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

test('uses the workspace installation when the web package lacks executable tsx', () => {
  const root = mkdtempSync(join(tmpdir(), 'gigl-tsx-path-'));
  try {
    const missing = join(root, 'web');
    const available = join(root, 'root');
    mkdirSync(join(available, '.bin'), { recursive: true });
    writeFileSync(join(available, '.bin/tsx'), '#!/bin/sh\n');
    chmodSync(join(available, '.bin/tsx'), 0o755);
    if (findTsxModules([missing, available]) !== available)
      throw new Error('tsx fallback not selected');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('installed GIGL wrapper and Linux lock proofs use the real tsx loader', {
  skip: process.platform !== 'linux',
  timeout: 240000,
}, () => {
  const modules = findTsxModules([
    `${web}node_modules`,
    `${repository}node_modules`,
  ]);
  if (!modules) throw new Error('A Linux-native tsx installation is required');
  const options = {
    cwd: web,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, GIGL_REAL_TSX_MODULES: modules },
  };
  for (const name of [
    'gigl-worker-launch-linux-probe.py',
    'gigl-flock-linux-probe.py',
  ]) {
    execFileSync('python3', [`${repository}tools/test/${name}`], options);
  }
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));

test('execs the GIGL tracking entrypoint in the current process with the tsx loader', () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'baci-gigl-loader-'));
  const webDir = join(repoDir, 'apps/web');
  const tsxBin = join(webDir, 'node_modules/.bin/tsx');
  const fakeBin = join(repoDir, 'fake-bin');
  const capture = join(repoDir, 'node-args');
  mkdirSync(join(webDir, 'src/scripts'), { recursive: true });
  mkdirSync(dirname(tsxBin), { recursive: true });
  mkdirSync(fakeBin);
  writeFileSync(
    join(webDir, 'src/scripts/process-gigl-tracking.ts'),
    'export {};\n'
  );
  writeFileSync(tsxBin, '#!/bin/sh\necho 4.0.0\n');
  chmodSync(tsxBin, 0o755);
  writeFileSync(
    join(fakeBin, 'node'),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\n'
  );
  chmodSync(join(fakeBin, 'node'), 0o755);
  const result = spawnSync(
    'bash',
    [
      join(scriptDir, 'run-web-script.sh'),
      'gigl-tracking',
      'src/scripts/process-gigl-tracking.ts',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        BACI_REPO_DIR: repoDir,
        BACI_WORKER_ENV: '/dev/null',
        NODE_ENV: 'test',
        CAPTURE: capture,
      },
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(capture, 'utf8').trim().split('\n'), [
    '--import',
    'tsx',
    '--conditions',
    'react-server',
    join(realpathSync(webDir), 'src/scripts/process-gigl-tracking.ts'),
  ]);
});

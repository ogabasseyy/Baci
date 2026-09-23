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
const runWebScript = readFileSync(join(scriptDir, 'run-web-script.sh'), 'utf8');

test('runs web scripts with the React Server condition', () => {
  assert.match(
    runWebScript,
    /"\$TSX_BIN" --conditions react-server "\$SCRIPT_FILE" "\$@"/
  );
});

test('uses the installed tsx binary without triggering pnpm dependency mutation', () => {
  assert.match(runWebScript, /TSX_BIN="\$WEB_DIR\/node_modules\/\.bin\/tsx"/);
  assert.doesNotMatch(runWebScript, /pnpm .*exec tsx/);
});

test('passes optional worker arguments through to the TypeScript entrypoint', () => {
  assert.match(runWebScript, /shift 2/);
  assert.match(runWebScript, /\[script-args\.\.\.\]/);
});

test('runs tsx from apps/web so web tsconfig aliases resolve', () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'baci-web-worker-'));
  const webDir = join(repoDir, 'apps/web');
  const tsxBin = join(webDir, 'node_modules/.bin/tsx');
  const envFile = join(repoDir, 'worker.env');
  const capturedCwd = join(repoDir, 'cwd.txt');
  mkdirSync(join(webDir, 'src/scripts'), { recursive: true });
  mkdirSync(dirname(tsxBin), { recursive: true });
  writeFileSync(join(webDir, 'src/scripts/test.ts'), 'export {};\n');
  writeFileSync(envFile, 'BACI_REPO_DIR=/unused\n');
  writeFileSync(
    tsxBin,
    '#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo 4.0.0; exit 0; fi\npwd > "$CAPTURED_CWD"\n'
  );
  chmodSync(tsxBin, 0o755);

  const result = spawnSync(
    'bash',
    [
      join(scriptDir, 'run-web-script.sh'),
      'test-worker',
      'src/scripts/test.ts',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        BACI_REPO_DIR: repoDir,
        BACI_WORKER_ENV: envFile,
        CAPTURED_CWD: capturedCwd,
        NODE_ENV: 'test',
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(capturedCwd, 'utf8').trim(), realpathSync(webDir));
});

test('uses the workspace tsx binary when a production deploy omits the app-local link', () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'baci-web-worker-root-tsx-'));
  const webDir = join(repoDir, 'apps/web');
  const tsxBin = join(repoDir, 'node_modules/.bin/tsx');
  const envFile = join(repoDir, 'worker.env');
  const capturedCwd = join(repoDir, 'cwd.txt');
  mkdirSync(join(webDir, 'src/scripts'), { recursive: true });
  mkdirSync(dirname(tsxBin), { recursive: true });
  writeFileSync(join(webDir, 'src/scripts/test.ts'), 'export {};\n');
  writeFileSync(envFile, 'BACI_REPO_DIR=/unused\n');
  writeFileSync(
    tsxBin,
    '#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo 4.0.0; exit 0; fi\npwd > "$CAPTURED_CWD"\n'
  );
  chmodSync(tsxBin, 0o755);

  const result = spawnSync(
    'bash',
    [
      join(scriptDir, 'run-web-script.sh'),
      'test-worker',
      'src/scripts/test.ts',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        BACI_REPO_DIR: repoDir,
        BACI_WORKER_ENV: envFile,
        CAPTURED_CWD: capturedCwd,
        NODE_ENV: 'test',
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(capturedCwd, 'utf8').trim(), realpathSync(webDir));
});

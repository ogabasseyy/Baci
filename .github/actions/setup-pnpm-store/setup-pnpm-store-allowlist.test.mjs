import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STORE_ACTION = join(ROOT, '.github/actions/setup-pnpm-store/action.yml');
const INSTALL_ACTION = join(ROOT, '.github/actions/pnpm-install-cached/action.yml');

function runBlock(actionPath, stepName) {
  const lines = readFileSync(actionPath, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  assert.notEqual(start, -1, `step not found: ${stepName}`);
  const runIdx = lines.findIndex((l, i) => i > start && /^\s*run:\s*\|?\s*$/.test(l));
  const body = [];
  for (let i = runIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^ {6}\S/.test(line) && !line.startsWith('          ') && line.trim() !== '') break;
    if (/^    \S/.test(line)) break;
    body.push(line.replace(/^ {10}/, ''));
  }
  return body.join('\n');
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'pnpm-store-allowlist-'));
  const log = join(dir, 'exec.log');
  const stub = `#!/usr/bin/env bash\necho "$0 $*" >> ${JSON.stringify(log)}\n`;
  mkdirSync(join(dir, '.github', 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'trusted-ops', '.github', 'scripts'), { recursive: true });
  writeFileSync(join(dir, '.github', 'scripts', 'pnpm-install-with-retry.sh'), stub, { mode: 0o755 });
  writeFileSync(join(dir, 'trusted-ops', '.github', 'scripts', 'pnpm-install-with-retry.sh'), stub, { mode: 0o755 });
  writeFileSync(join(dir, 'pnpm'), stub, { mode: 0o755 });
  return { dir, log };
}

function dispatch(script, installCommand, cwd, extraEnv = {}) {
  return spawnSync('bash', ['-c', script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, INSTALL_COMMAND: installCommand, PATH: `${cwd}:${process.env.PATH}`, ...extraEnv },
  });
}

const INSTALL_STEP = 'Install Dependencies';

function allRunBodies(actionPath) {
  const lines = readFileSync(actionPath, 'utf8').split('\n');
  const bodies = [];
  for (let i = 0; i < lines.length; i += 1) {
    const block = lines[i].match(/^(\s*)run:\s*(\|.*)?$/);
    if (block && block[2] !== undefined) {
      const base = block[1].length;
      const body = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j];
        if (line.trim() === '') {
          body.push('');
          continue;
        }
        if (/^\s/.test(line) && line.search(/\S/) > base) {
          body.push(line);
          continue;
        }
        break;
      }
      bodies.push(body.join('\n'));
      continue;
    }
    const single = lines[i].match(/^\s*run:\s+(.+)$/);
    if (single) bodies.push(single[1]);
  }
  return bodies;
}

test('run blocks contain no expression interpolation (injection vector gone)', () => {
  for (const actionPath of [STORE_ACTION, INSTALL_ACTION]) {
    const bodies = allRunBodies(actionPath);
    assert.ok(bodies.length > 0, `expected run blocks in ${actionPath}`);
    for (const body of bodies) {
      assert.ok(!body.includes('${{'), `run block must not interpolate contexts in ${actionPath}:\n${body}`);
    }
  }
});

test('every workflow caller command is allowlisted (contract test)', () => {
  const script = runBlock(INSTALL_ACTION, INSTALL_STEP);
  const patterns = [...script.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  const allowed = new Set(patterns);
  const callers = [];
  const workflows = execFileSync('grep', ['-rh', 'install-command:', join(ROOT, '.github', 'workflows')], { encoding: 'utf8' });
  for (const line of workflows.split('\n')) {
    const m = line.match(/install-command:\s*(.+?)\s*$/);
    if (m) callers.push(m[1]);
  }
  assert.ok(callers.length > 0, 'expected workflow callers');
  for (const cmd of callers) {
    assert.ok(allowed.has(cmd), `caller command not allowlisted: ${cmd}`);
  }
});

test('enumerated commands execute, hostile inputs fail closed', () => {
  const script = runBlock(INSTALL_ACTION, INSTALL_STEP);
  const { dir, log } = sandbox();
  const sentinel = join(dir, 'exec-proof-sentinel');
  try {
    const good = [
      './.github/scripts/pnpm-install-with-retry.sh --frozen-lockfile --prefer-offline',
      'pnpm install',
    ];
    for (const cmd of good) {
      const r = dispatch(script, cmd, dir);
      assert.equal(r.status, 0, `allowlisted command must run: ${cmd}\n${r.stderr}`);
    }
    assert.ok(readFileSync(log, 'utf8').length > 0, 'stubs must observe execution');

    const evil = [
      "'; rm -rf /tmp/pwned-allowlist; echo '",
      '$(touch /tmp/pwned-allowlist)',
      '',
      'pnpm install --frozen-lockfile --prefer-offline --extra-flag',
      'PNPM INSTALL',
      'pnpm install --frozen-lockfile --prefer-offline\ntouch /tmp/pwned-allowlist',
      'npm ci',
      `x"; touch "${sentinel}"; echo "`,
    ];
    for (const cmd of evil) {
      const before = readFileSync(log, 'utf8');
      const r = dispatch(script, cmd, dir, { SENTINEL: sentinel });
      assert.notEqual(r.status, 0, `hostile input must fail closed: ${JSON.stringify(cmd)}`);
      assert.equal(readFileSync(log, 'utf8'), before, `hostile input must not execute: ${JSON.stringify(cmd)}`);
      assert.ok(!existsSync(sentinel), `hostile input must leave no side effects: ${JSON.stringify(cmd)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function assertEnvRoundTrip(script, cwd, label) {
  const envFile = join(cwd, 'github_env');
  writeFileSync(envFile, '');
  const hostile = 'x\nEOF\nINJECTED=1';
  const r = spawnSync('bash', ['-c', script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, STORE_DIR: hostile, GITHUB_ENV: envFile, GITHUB_PATH: join(cwd, 'github_path'), PATH: `${cwd}:${process.env.PATH}` },
  });
  assert.equal(r.status, 0, `${label}: ${r.stderr}`);
  const lines = readFileSync(envFile, 'utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  assert.ok(lines[0].startsWith('PNPM_STORE_DIR<<'), `${label}: multiline-safe delimiter form`);
  const delimiter = lines[0].slice('PNPM_STORE_DIR<<'.length);
  assert.ok(delimiter !== '' && delimiter !== 'EOF', `${label}: delimiter must not be static`);
  assert.equal(lines[lines.length - 1], delimiter, `${label}: value stays inside one assignment`);
  const value = lines.slice(1, -1).join('\n');
  assert.equal(value, hostile, `${label}: hostile value round-trips as one variable`);
}

test('env writes keep hostile values inside one assignment (both actions)', () => {
  assertEnvRoundTrip(runBlock(STORE_ACTION, 'Export PNPM_STORE_DIR'), mkdtempSync(join(tmpdir(), 'pnpm-store-env-')), STORE_ACTION);
  const { dir } = sandbox();
  try {
    assertEnvRoundTrip(runBlock(INSTALL_ACTION, 'Configure pnpm store directory'), dir, INSTALL_ACTION);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

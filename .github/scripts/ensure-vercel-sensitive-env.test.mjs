import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const SCRIPT = fileURLToPath(
  new URL('./ensure-vercel-sensitive-env.mjs', import.meta.url),
);
const DEPLOY_WORKFLOW = fileURLToPath(
  new URL('../workflows/deploy.yml', import.meta.url),
);
const KEY = 'MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET';

function makeRuntime(envContents) {
  const directory = mkdtempSync(join(tmpdir(), 'ensure-vercel-sensitive-env-'));
  const file = join(directory, '.env.production.local');
  const callsFile = join(directory, 'calls.jsonl');
  const stdinFile = join(directory, 'stdin.txt');
  const wrapper = join(directory, 'fake-pinned-vercel.cjs');
  writeFileSync(file, envContents);
  writeFileSync(
    wrapper,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const value = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.FAKE_CALLS_FILE, JSON.stringify(args) + '\\n');
fs.writeFileSync(process.env.FAKE_STDIN_FILE, value);
process.stdout.write(value);
process.stderr.write(value);
if (process.env.FAKE_FAIL === '1') process.exit(1);
`,
    { mode: 0o755 },
  );

  return { callsFile, directory, file, stdinFile, wrapper };
}

function run(runtime, env = {}) {
  return spawnSync('node', [SCRIPT, KEY, runtime.file, runtime.wrapper], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FAKE_CALLS_FILE: runtime.callsFile,
      FAKE_STDIN_FILE: runtime.stdinFile,
      ...env,
    },
  });
}

function readCalls(runtime) {
  if (!readdirSync(runtime.directory).includes('calls.jsonl')) return [];
  return readFileSync(runtime.callsFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('no-ops when the pulled Production key is already defined', () => {
  const runtime = makeRuntime(`${KEY}=""\n`);

  try {
    const result = run(runtime);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readCalls(runtime), []);
    assert.match(result.stdout, /already defined/);
    assert.equal(readFileSync(runtime.file, 'utf8'), `${KEY}=""\n`);
  } finally {
    rmSync(runtime.directory, { recursive: true, force: true });
  }
});

test('creates a Production sensitive key and records the blank placeholder', () => {
  const runtime = makeRuntime('QUIZ_PHASE="production"\n');

  try {
    const result = run(runtime);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readCalls(runtime), [
      ['env', 'add', KEY, 'production', '--sensitive', '--yes'],
    ]);
    const secret = readFileSync(runtime.stdinFile, 'utf8');
    assert.match(secret, /^[a-f0-9]{64}$/);
    assert.equal(readFileSync(runtime.file, 'utf8'), `QUIZ_PHASE="production"\n${KEY}=""\n`);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
    assert.match(result.stdout, /has been created/);
  } finally {
    rmSync(runtime.directory, { recursive: true, force: true });
  }
});

test('fails closed when Vercel refuses to create the missing key', () => {
  const runtime = makeRuntime('QUIZ_PHASE="production"\n');

  try {
    const result = run(runtime, { FAKE_FAIL: '1' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Failed to create/);
    assert.equal(readFileSync(runtime.file, 'utf8'), 'QUIZ_PHASE="production"\n');
    const secret = readFileSync(runtime.stdinFile, 'utf8');
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
  } finally {
    rmSync(runtime.directory, { recursive: true, force: true });
  }
});

test('fails closed when the pulled key has ambiguous duplicate assignments', () => {
  const runtime = makeRuntime(`${KEY}=""\n${KEY}=""\n`);

  try {
    const result = run(runtime);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /ambiguous/);
    assert.deepEqual(readCalls(runtime), []);
  } finally {
    rmSync(runtime.directory, { recursive: true, force: true });
  }
});

test('production prebuilt deploy provisions a missing HMAC key after pull and before the presence assert', () => {
  const workflow = readFileSync(DEPLOY_WORKFLOW, 'utf8');
  const pullStart = workflow.indexOf(
    'run: .github/scripts/run-pinned-vercel.sh pull --yes --environment=production',
  );
  const ensureStart = workflow.indexOf(
    'ensure-vercel-sensitive-env.mjs MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET',
    pullStart,
  );
  const readinessStart = workflow.indexOf(
    'assert-vercel-pulled-sensitive-env.mjs MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET',
    pullStart,
  );
  const buildStart = workflow.indexOf('      - name: Build for Vercel', pullStart);

  assert.ok(pullStart >= 0);
  assert.ok(ensureStart > pullStart);
  assert.ok(readinessStart > ensureStart);
  assert.ok(readinessStart < buildStart);
  assert.match(
    workflow.slice(ensureStart, readinessStart),
    /run-pinned-vercel\.sh/,
  );
});

test('ensure-script edits trigger production deployment and the deployment-script CI gate', () => {
  const deploy = YAML.parse(readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8'));
  const ci = YAML.parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  const guardPaths = [
    '.github/scripts/ensure-vercel-sensitive-env.mjs',
    '.github/scripts/ensure-vercel-sensitive-env.test.mjs',
  ];

  for (const path of guardPaths) {
    assert.ok(deploy.web.includes(path), `${path} must trigger the web deployment`);
    assert.ok(ci.deploy_scripts.includes(path), `${path} must trigger deployment-script tests`);
  }
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(
  new URL('./assert-vercel-pulled-sensitive-env.mjs', import.meta.url),
);
const DEPLOY_WORKFLOW = fileURLToPath(
  new URL('../workflows/deploy.yml', import.meta.url),
);
const KEY = 'MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET';

function withPulledEnv(contents, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'assert-vercel-pulled-env-'));
  const file = join(directory, '.env.production.local');
  writeFileSync(file, contents);

  try {
    callback(file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function run(file, key = KEY) {
  return spawnSync('node', [SCRIPT, key, file], { encoding: 'utf8' });
}

test('accepts Vercel\'s explicit blank sensitive placeholder without exposing its value', () => {
  withPulledEnv(`${KEY}=""\nQUIZ_PHASE="production"\n`, (file) => {
    const result = run(file);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`^${KEY} is present`, 'm'));
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /QUIZ_PHASE/);
  });
});

test('fails closed before a prebuilt deployment when the required Vercel key is absent', () => {
  withPulledEnv('QUIZ_PHASE="production"\n', (file) => {
    const result = run(file);

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${KEY}.*absent`, 'i'));
  });
});

test('fails closed when the required Vercel key has ambiguous duplicate assignments', () => {
  withPulledEnv(`${KEY}=""\n${KEY}=""\n`, (file) => {
    const result = run(file);

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${KEY}.*ambiguous`, 'i'));
  });
});

test('production prebuilt deploy checks key presence after pull and before build', () => {
  const workflow = readFileSync(DEPLOY_WORKFLOW, 'utf8');
  const pullStart = workflow.indexOf(
    'run: .github/scripts/run-pinned-vercel.sh pull --yes --environment=production',
  );
  const buildStart = workflow.indexOf('      - name: Build for Vercel', pullStart);
  const readinessStart = workflow.indexOf(
    'assert-vercel-pulled-sensitive-env.mjs MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET',
    pullStart,
  );
  const readinessStepStart = workflow.lastIndexOf('      - name:', readinessStart);

  assert.ok(pullStart >= 0);
  assert.ok(readinessStart > pullStart);
  assert.ok(readinessStart < buildStart);
  assert.match(
    workflow.slice(readinessStepStart, buildStart),
    /not its runtime value/,
  );
});

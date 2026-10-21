import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const DEPLOY_WORKFLOW = fileURLToPath(
  new URL('../workflows/deploy.yml', import.meta.url),
);
const PREVIEW_WORKFLOW = fileURLToPath(
  new URL('../workflows/preview.yml', import.meta.url),
);

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
  const ensureCommand = workflow.slice(ensureStart, readinessStart);

  assert.ok(pullStart >= 0);
  assert.ok(ensureStart > pullStart);
  assert.ok(readinessStart > ensureStart);
  assert.ok(readinessStart < buildStart);
  assert.doesNotMatch(ensureCommand, /run-pinned-vercel\.sh/);
  assert.doesNotMatch(ensureCommand, /env add/);
});

test('preview deploy provisions a missing Preview-target HMAC key after pull and before the presence assert', () => {
  const workflow = readFileSync(PREVIEW_WORKFLOW, 'utf8');
  const pullStart = workflow.indexOf(
    'run: .github/scripts/run-pinned-vercel.sh pull --yes --environment=preview',
  );
  const ensureStart = workflow.indexOf(
    'ensure-vercel-sensitive-env.mjs SUPABASE_STOREFRONT_INTAKE_NET_KEY',
    pullStart,
  );
  const readinessStart = workflow.indexOf(
    'assert-vercel-pulled-sensitive-env.mjs SUPABASE_STOREFRONT_INTAKE_NET_KEY',
    pullStart,
  );
  const ensureCommand = workflow.slice(ensureStart, readinessStart);

  assert.ok(pullStart >= 0);
  assert.ok(ensureStart > pullStart);
  assert.ok(readinessStart > ensureStart);
  assert.match(ensureCommand, /--target preview/);
  assert.doesNotMatch(ensureCommand, /run-pinned-vercel\.sh/);
  assert.doesNotMatch(ensureCommand, /env add/);
});

test('ensure-script edits trigger production deployment and the deployment-script CI gate', () => {
  const deploy = YAML.parse(readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8'));
  const ci = YAML.parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  const guardPaths = [
    '.github/scripts/ensure-vercel-sensitive-env.mjs',
    '.github/scripts/ensure-vercel-sensitive-env.test.mjs',
    '.github/scripts/ensure-vercel-sensitive-env.workflow.test.mjs',
    '.github/scripts/ensure-vercel-sensitive-env-harness.mjs',
  ];

  for (const path of guardPaths) {
    assert.ok(deploy.web.includes(path), `${path} must trigger the web deployment`);
    assert.ok(ci.deploy_scripts.includes(path), `${path} must trigger deployment-script tests`);
  }
});

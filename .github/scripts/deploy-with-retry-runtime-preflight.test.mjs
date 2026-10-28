import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import {
  makeFakeCommand,
  prevProdEnv,
  writeCountingOverlapCheck,
  writeFakeCurl,
} from './deploy-with-retry.test-helpers.mjs';
import { runScript } from './deploy-with-retry.run-script.mjs';

function healthCheck(tempDir, body) {
  const path = `${tempDir}/runtime-preflight`;
  const calls = `${tempDir}/runtime-calls`;
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\nn=0\n[ ! -f "${calls}" ] || n="$(cat "${calls}")"\necho "$((n + 1))" > "${calls}"\n${body}\n`, { mode: 0o755 });
  return { path, calls };
}

test('runtime preflight failure rolls back exact prior deployment and is never retried', () => {
  const fake = makeFakeCommand('success');
  const overlap = writeCountingOverlapCheck(fake.tempDir, 'exit 0');
  const health = healthCheck(fake.tempDir, 'exit 1');
  const curlCalls = writeFakeCurl(fake.binDir, fake.tempDir);
  try {
    const result = runScript(fake, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: overlap.checkPath,
      DEPLOY_POST_PROMOTE_HEALTH_CHECK: health.path,
      PROMOTE_ATTEMPTS: '2',
      ...prevProdEnv,
      CURL_BODY_2: '{"deploymentId":"dpl_candidate","deployment":{"url":"baci-success.vercel.app"}}',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /runtime preflight failure/);
    assert.equal(readFileSync(fake.rollbackFile, 'utf8').trim(), 'dpl_previous123');
    assert.equal(readFileSync(fake.rollbackCountFile, 'utf8').trim(), '1');
    assert.equal(readFileSync(health.calls, 'utf8').trim(), '1');
    assert.equal(readFileSync(overlap.callsPath, 'utf8').trim(), '2');
    assert.equal(readFileSync(curlCalls, 'utf8').trim(), '3');
  } finally {
    rmSync(fake.tempDir, { recursive: true, force: true });
  }
});

test('withholds runtime probe and restores prior deployment when alias is stale after promote', () => {
  const fake = makeFakeCommand('success');
  const overlap = writeCountingOverlapCheck(fake.tempDir, 'exit 0');
  const health = healthCheck(fake.tempDir, 'exit 1');
  const curlCalls = writeFakeCurl(fake.binDir, fake.tempDir);
  try {
    const result = runScript(fake, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: overlap.checkPath,
      DEPLOY_POST_PROMOTE_HEALTH_CHECK: health.path,
      PROMOTE_ATTEMPTS: '1',
      ...prevProdEnv,
      CURL_BODY_2: '{"deploymentId":"dpl_not_previous"}',
      CURL_BODY_3: '{"deploymentId":"dpl_not_previous"}',
      CURL_BODY_4: '{"deploymentId":"dpl_not_previous"}',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Production alias did not resolve to promoted candidate/);
    assert.equal(readFileSync(fake.rollbackFile, 'utf8').trim(), 'dpl_previous123');
    assert.equal(readFileSync(curlCalls, 'utf8').trim(), '5');
    assert.throws(() => readFileSync(health.calls, 'utf8'));
  } finally {
    rmSync(fake.tempDir, { recursive: true, force: true });
  }
});

test('health preflight cannot run without captured rollback guard', () => {
  const fake = makeFakeCommand('success');
  const health = healthCheck(fake.tempDir, 'exit 0');
  try {
    const result = runScript(fake, ['fake-vercel', 'deploy'], {
      DEPLOY_POST_PROMOTE_HEALTH_CHECK: health.path,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires DEPLOY_PROMOTE_OVERLAP_CHECK/);
    assert.throws(() => readFileSync(fake.attemptsFile, 'utf8'));
  } finally {
    rmSync(fake.tempDir, { recursive: true, force: true });
  }
});

test('uncertain rollback result remains a hard failure for manual reconciliation', () => {
  const fake = makeFakeCommand('success-rollback-fails');
  const overlap = writeCountingOverlapCheck(fake.tempDir, 'exit 0');
  const health = healthCheck(fake.tempDir, 'exit 1');
  writeFakeCurl(fake.binDir, fake.tempDir);
  try {
    const result = runScript(fake, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: overlap.checkPath,
      DEPLOY_POST_PROMOTE_HEALTH_CHECK: health.path,
      PROMOTE_ATTEMPTS: '2',
      ...prevProdEnv,
      CURL_BODY_2: '{"deploymentId":"dpl_candidate","deployment":{"url":"baci-success.vercel.app"}}',
      CURL_BODY_3: '{"deploymentId":"dpl_not_previous"}',
      CURL_BODY_4: '{"deploymentId":"dpl_not_previous"}',
      CURL_BODY_5: '{"deploymentId":"dpl_not_previous"}',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /manually restore dpl_previous/);
    assert.equal(readFileSync(fake.rollbackCountFile, 'utf8').trim(), '2');
    assert.equal(readFileSync(health.calls, 'utf8').trim(), '1');
  } finally {
    rmSync(fake.tempDir, { recursive: true, force: true });
  }
});

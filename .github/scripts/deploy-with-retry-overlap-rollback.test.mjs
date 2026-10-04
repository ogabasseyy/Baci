import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import test from 'node:test';

import {
  makeFakeCommand,
  prevProdEnv,
  vercelEnv,
  writeCountingOverlapCheck,
  writeFakeCurl,
} from './deploy-with-retry.test-helpers.mjs';
import { runScript } from './deploy-with-retry.run-script.mjs';

// Split from deploy-with-retry-overlap.test.mjs (near the 300-line
// limit): post-promote overlap recovery coverage — the `vercel
// rollback` path, the self-rollback refusal, and ambiguous-promote
// recovery. (A missing-alias 404 used to stage without a rollback
// target; capture now refuses before staging, covered in the parent
// suite, so no first-deploy overlap test remains here.)

test('rolls back to the previous production deployment on post-promote overlap', () => {
  const fakeCommand = makeFakeCommand('success');
  // The record persists: once the post-promote read trips, every
  // later read (including the retry's pre-check) refuses too.
  const { checkPath, callsPath } = writeCountingOverlapCheck(
    fakeCommand.tempDir,
    'if [ "$calls" -ge 1 ]; then exit 1; fi\nexit 0'
  );
  writeFakeCurl(fakeCommand.binDir, fakeCommand.tempDir);

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      PROMOTE_ATTEMPTS: '2',
      ...prevProdEnv,
    });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /overlapped the production promotion of https:\/\/baci-success\.vercel\.app/
    );
    assert.match(result.stderr, /Rolled production back to dpl_previous123/);
    // The initial promote recorded its target; the recovery ran
    // `rollback` (a previously-promoted deployment cannot be
    // promoted again), recorded separately.
    assert.equal(
      readFileSync(fakeCommand.promotedFile, 'utf8').trim(),
      'https://baci-success.vercel.app'
    );
    assert.equal(
      readFileSync(fakeCommand.rollbackFile, 'utf8').trim(),
      'dpl_previous123'
    );
    assert.equal(
      readFileSync(fakeCommand.rollbackCountFile, 'utf8').trim(),
      '1'
    );
    // Pre-allow, post-refuse (+rollback), retry pre-refuse.
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '3');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

test('fails loud with a manual directive when the rollback itself fails', () => {
  const fakeCommand = makeFakeCommand('success-rollback-fails');
  const { checkPath, callsPath } = writeCountingOverlapCheck(
    fakeCommand.tempDir,
    'if [ "$calls" -ge 1 ]; then exit 1; fi\nexit 0'
  );
  writeFakeCurl(fakeCommand.binDir, fakeCommand.tempDir);

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      PROMOTE_ATTEMPTS: '2',
      ...prevProdEnv,
    });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Rollback of https:\/\/baci-success\.vercel\.app to dpl_previous123 failed; manually roll back to dpl_previous123/
    );
    assert.throws(() => readFileSync(fakeCommand.rollbackFile, 'utf8'));
    // Both rollback retries ran before giving up.
    assert.equal(
      readFileSync(fakeCommand.rollbackCountFile, 'utf8').trim(),
      '2'
    );
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '3');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

test('refuses a rollback to the just-promoted candidate itself', () => {
  const fakeCommand = makeFakeCommand('success');
  const { checkPath, callsPath } = writeCountingOverlapCheck(
    fakeCommand.tempDir,
    'if [ "$calls" -ge 1 ]; then exit 1; fi\nexit 0'
  );
  writeFakeCurl(fakeCommand.binDir, fakeCommand.tempDir);

  try {
    // The capture answered with the candidate itself (regressed
    // timing or a misleading API): restoring it would be a no-op
    // leaving the stale-read release live, so fail loud instead.
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      PROMOTE_ATTEMPTS: '2',
      ...vercelEnv,
      CURL_BODY:
        '{"alias":"ogabassey.com","deploymentId":"dpl_self123","deployment":{"id":"dpl_self123","url":"baci-success.vercel.app"}}',
      CURL_CODE: '200',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /IS the just-promoted candidate; manually reconcile/);
    // Promoted but unrolled-back: no rollback ran at all.
    assert.equal(
      readFileSync(fakeCommand.promotedFile, 'utf8').trim(),
      'https://baci-success.vercel.app'
    );
    assert.throws(() => readFileSync(fakeCommand.rollbackFile, 'utf8'));
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '3');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

// The alias serving the just-staged candidate (second capture): the
// promote "failed" client-side but took effect server-side.
const CANDIDATE_SERVING_BODY =
  '{"alias":"ogabassey.com","deploymentId":"dpl_success999","deployment":{"id":"dpl_success999","url":"baci-success.vercel.app"},"projectId":"prj_test"}';

test('rolls back on overlap when an ambiguous promote took effect', () => {
  const fakeCommand = makeFakeCommand('success-promote-fails');
  const { checkPath, callsPath } = writeCountingOverlapCheck(
    fakeCommand.tempDir,
    'if [ "$calls" -ge 1 ]; then exit 1; fi\nexit 0'
  );
  writeFakeCurl(fakeCommand.binDir, fakeCommand.tempDir);

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      PROMOTE_ATTEMPTS: '2',
      ...vercelEnv,
      CURL_CODE: '200',
      CURL_BODY_1: prevProdEnv.CURL_BODY,
      CURL_BODY_2: CANDIDATE_SERVING_BODY,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /failed ambiguously/);
    assert.match(result.stderr, /Rolled production back to dpl_previous123/);
    assert.equal(
      readFileSync(fakeCommand.rollbackFile, 'utf8').trim(),
      'dpl_previous123'
    );
    // Pre-allow, recovery-verify-refuse (+rollback), retry pre-refuse.
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '3');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

test('recovers success when an ambiguous promote took effect cleanly', () => {
  const fakeCommand = makeFakeCommand('success-promote-fails');
  const { checkPath, callsPath } = writeCountingOverlapCheck(
    fakeCommand.tempDir,
    'exit 0'
  );
  writeFakeCurl(fakeCommand.binDir, fakeCommand.tempDir);

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      PROMOTE_ATTEMPTS: '2',
      ...vercelEnv,
      CURL_CODE: '200',
      CURL_BODY_1: prevProdEnv.CURL_BODY,
      CURL_BODY_2: CANDIDATE_SERVING_BODY,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /failed ambiguously/);
    assert.match(
      result.stdout,
      /Promoted https:\/\/baci-success\.vercel\.app to production/
    );
    assert.throws(() => readFileSync(fakeCommand.rollbackFile, 'utf8'));
    // Pre-allow, recovery-verify-allow: no retry, no rollback.
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '2');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

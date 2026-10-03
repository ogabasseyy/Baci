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

// Recovery-path coverage (rollback, self-refusal, first-deploy
// overlap) lives in deploy-with-retry-overlap-rollback.test.mjs
// (split to keep both suites under the 300-line limit).

test('promotes when the overlap check allows the promotion', () => {
  const fakeCommand = makeFakeCommand('success');
  const { checkPath, callsPath } = writeCountingOverlapCheck(
    fakeCommand.tempDir,
    'exit 0'
  );
  const curlCallsPath = writeFakeCurl(
    fakeCommand.binDir,
    fakeCommand.tempDir
  );

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      ...prevProdEnv,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Promoted https:\/\/baci-success\.vercel\.app to production/
    );
    assert.equal(
      readFileSync(fakeCommand.promotedFile, 'utf8').trim(),
      'https://baci-success.vercel.app'
    );
    // Pre-promote AND post-promote reads (the durable exclusion
    // re-reads after the promote; a record written during it would
    // roll back here).
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '2');
    assert.equal(readFileSync(curlCallsPath, 'utf8').trim(), '1');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

test('refuses every promote attempt when the overlap check rejects', () => {
  const fakeCommand = makeFakeCommand('success');
  const { checkPath, callsPath } = writeCountingOverlapCheck(
    fakeCommand.tempDir,
    'exit 1'
  );
  const curlCallsPath = writeFakeCurl(
    fakeCommand.binDir,
    fakeCommand.tempDir
  );

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      PROMOTE_ATTEMPTS: '2',
      ...prevProdEnv,
    });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /worker-promote overlap check refused to promote https:\/\/baci-success\.vercel\.app/
    );
    assert.match(result.stderr, /Deploy succeeded but promote failed/);
    // No promote command ever ran: the refusal happens before it.
    // The rollback target was captured once, before the first staging.
    assert.throws(() => readFileSync(fakeCommand.promotedFile, 'utf8'));
    assert.equal(readFileSync(curlCallsPath, 'utf8').trim(), '1');
    // Both promote attempts re-checked (the record is re-read, not cached).
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '2');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

test('promotes on retry when the overlap clears between attempts', () => {
  const fakeCommand = makeFakeCommand('success');
  const { checkPath, callsPath } = writeCountingOverlapCheck(
    fakeCommand.tempDir,
    'if [ "$calls" -eq 0 ]; then exit 1; fi\nexit 0'
  );
  const curlCallsPath = writeFakeCurl(
    fakeCommand.binDir,
    fakeCommand.tempDir
  );

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      PROMOTE_ATTEMPTS: '2',
      ...prevProdEnv,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Promote of .* failed.*retrying/);
    assert.equal(
      readFileSync(fakeCommand.promotedFile, 'utf8').trim(),
      'https://baci-success.vercel.app'
    );
    // Pre-refuse, pre-allow, post-allow; one capture (once per
    // process, before the first staging).
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '3');
    assert.equal(readFileSync(curlCallsPath, 'utf8').trim(), '1');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

test('refuses the promote when the rollback target cannot be captured', () => {
  const fakeCommand = makeFakeCommand('success');
  const { checkPath, callsPath } = writeCountingOverlapCheck(
    fakeCommand.tempDir,
    'exit 0'
  );
  const curlCallsPath = writeFakeCurl(
    fakeCommand.binDir,
    fakeCommand.tempDir
  );

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      PROMOTE_ATTEMPTS: '2',
      ...vercelEnv,
      CURL_EXIT: '1',
    });

    // Neither deploy attempt staged anything (capture precedes
    // staging), so both retries re-captured cleanly and the overlap
    // check never ran.
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no rollback target could be captured/);
    assert.match(result.stdout, /Deploy failed after 2 attempts/);
    assert.throws(() => readFileSync(fakeCommand.promotedFile, 'utf8'));
    assert.throws(() => readFileSync(callsPath, 'utf8'));
    assert.equal(readFileSync(curlCallsPath, 'utf8').trim(), '2');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

test('refuses the attempt when the alias response is unparseable', () => {
  const fakeCommand = makeFakeCommand('success');
  const { checkPath, callsPath } = writeCountingOverlapCheck(
    fakeCommand.tempDir,
    'exit 0'
  );
  const curlCallsPath = writeFakeCurl(
    fakeCommand.binDir,
    fakeCommand.tempDir
  );

  try {
    // HTTP 200 without the REQUIRED deploymentId: an API shape
    // change must never read as "no previous" (first deploy is a
    // 404, covered by the next test).
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      MAX_ATTEMPTS: '1',
      ...vercelEnv,
      CURL_BODY: '{"alias":"ogabassey.com"}',
      CURL_CODE: '200',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /unparseable Vercel API response/);
    assert.match(result.stdout, /Deploy failed after 1 attempts/);
    assert.throws(() => readFileSync(fakeCommand.promotedFile, 'utf8'));
    assert.throws(() => readFileSync(callsPath, 'utf8'));
    assert.equal(readFileSync(curlCallsPath, 'utf8').trim(), '1');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

test('promotes without a rollback target on the first deploy', () => {
  const fakeCommand = makeFakeCommand('success');
  const { checkPath, callsPath } = writeCountingOverlapCheck(
    fakeCommand.tempDir,
    'exit 0'
  );
  writeFakeCurl(fakeCommand.binDir, fakeCommand.tempDir);

  try {
    // No production alias yet (404): first deploy.
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      ...vercelEnv,
      CURL_BODY: '{}',
      CURL_CODE: '404',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stderr,
      /no previous production deployment found; overlap rollbacks in this run will fail loud instead/
    );
    assert.equal(
      readFileSync(fakeCommand.promotedFile, 'utf8').trim(),
      'https://baci-success.vercel.app'
    );
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '2');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

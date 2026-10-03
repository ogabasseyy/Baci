import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import { makeFakeCommand } from './deploy-with-retry.test-helpers.mjs';
import { runScript } from './deploy-with-retry.run-script.mjs';

function writeCountingOverlapCheck(tempDir, behavior) {
  const checkPath = `${tempDir}/overlap-check`;
  const callsPath = `${tempDir}/overlap-calls`;
  writeFileSync(
    checkPath,
    `#!/usr/bin/env bash
set -euo pipefail
calls=0
if [ -f "${callsPath}" ]; then calls="$(cat "${callsPath}")"; fi
printf '%s\\n' "$((calls + 1))" >"${callsPath}"
${behavior}
`,
    { mode: 0o755 }
  );
  return { checkPath, callsPath };
}

// Fake curl answering the previous-production capture: writes
// CURL_BODY to the -o file and prints CURL_CODE (no trailing
// newline, like curl -w). CURL_EXIT nonzero fails without output.
function writeFakeCurl(binDir, tempDir) {
  const callsPath = `${tempDir}/curl-calls`;
  writeFileSync(
    `${binDir}/curl`,
    `#!/usr/bin/env bash
calls=0
if [ -f "${callsPath}" ]; then calls="$(cat "${callsPath}")"; fi
printf '%s\\n' "$((calls + 1))" >"${callsPath}"
if [ "\${CURL_EXIT:-0}" != "0" ]; then exit "$CURL_EXIT"; fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then out="$arg"; fi
  prev="$arg"
done
printf '%s' "\${CURL_BODY:-}" > "$out"
printf '%s' "\${CURL_CODE:-200}"
`,
    { mode: 0o755 }
  );
  return callsPath;
}

const vercelEnv = {
  VERCEL_TOKEN: 'test-token',
  VERCEL_PROJECT_ID: 'prj_test',
  VERCEL_ORG_ID: 'team_test',
};

const prevProdEnv = {
  ...vercelEnv,
  CURL_BODY:
    '{"deployments":[{"uid":"dpl_previous123","url":"baci-previous.vercel.app"}]}',
  CURL_CODE: '200',
};

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
    // No promote command ever ran: the refusal happens before it —
    // and no rollback target was captured either.
    assert.throws(() => readFileSync(fakeCommand.promotedFile, 'utf8'));
    assert.throws(() => readFileSync(curlCallsPath, 'utf8'));
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
    // Pre-refuse, pre-allow, post-allow; one capture (only the second
    // attempt promoted).
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '3');
    assert.equal(readFileSync(curlCallsPath, 'utf8').trim(), '1');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

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
    // The rollback re-promote overwrote the recorded target.
    assert.equal(
      readFileSync(fakeCommand.promotedFile, 'utf8').trim(),
      'dpl_previous123'
    );
    // Pre-allow, post-refuse (+rollback), retry pre-refuse.
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '3');
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

    assert.equal(result.status, 1);
    assert.match(result.stderr, /no rollback target could be captured/);
    // No promote command ever ran on either attempt.
    assert.throws(() => readFileSync(fakeCommand.promotedFile, 'utf8'));
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '2');
    assert.equal(readFileSync(curlCallsPath, 'utf8').trim(), '2');
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
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      ...vercelEnv,
      CURL_BODY: '{"deployments":[]}',
      CURL_CODE: '200',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stderr,
      /no previous production deployment found; promoting .* without a rollback target/
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

test('fails loud without rollback when the first deploy overlaps post-promote', () => {
  const fakeCommand = makeFakeCommand('success');
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
      CURL_BODY: '{"deployments":[]}',
      CURL_CODE: '200',
    });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /No previous production deployment to roll back to; manually reconcile/
    );
    // Published but unrolled-back: the recorded target is untouched.
    assert.equal(
      readFileSync(fakeCommand.promotedFile, 'utf8').trim(),
      'https://baci-success.vercel.app'
    );
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '3');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

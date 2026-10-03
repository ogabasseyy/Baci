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

test('promotes when the overlap check allows the promotion', () => {
  const fakeCommand = makeFakeCommand('success');
  const { checkPath, callsPath } = writeCountingOverlapCheck(
    fakeCommand.tempDir,
    'exit 0'
  );

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
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
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '1');
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

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      PROMOTE_ATTEMPTS: '2',
    });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /worker-promote overlap check refused to promote https:\/\/baci-success\.vercel\.app/
    );
    assert.match(result.stderr, /Deploy succeeded but promote failed/);
    // No promote command ever ran: the refusal happens before it.
    assert.throws(() => readFileSync(fakeCommand.promotedFile, 'utf8'));
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

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_PROMOTE_OVERLAP_CHECK: checkPath,
      PROMOTE_ATTEMPTS: '2',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Promote of .* failed.*retrying/);
    assert.equal(
      readFileSync(fakeCommand.promotedFile, 'utf8').trim(),
      'https://baci-success.vercel.app'
    );
    assert.equal(readFileSync(callsPath, 'utf8').trim(), '2');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

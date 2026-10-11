import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertJobDeadline,
  assertPreCommitGuards,
  prepareOwnedStaging,
} from './generate-job.mjs';

async function setup() {
  const base = join(
    tmpdir(),
    `pilot-gen-job-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const outputRoot = join(base, 'output');
  await mkdir(outputRoot, { recursive: true });
  return { base, outputRoot };
}

test('assertPreCommitGuards rechecks the deadline and the disk floor', async () => {
  const { outputRoot } = await setup();
  await mkdir(join(outputRoot, 'generations'), { recursive: true });
  await assert.rejects(
    () =>
      assertPreCommitGuards({
        deadlineMs: Date.now() + 60_000,
        minFreeBytes: Number.MAX_SAFE_INTEGER,
        outputRoot,
      }),
    /below the .* byte floor/
  );
  await assert.rejects(
    () =>
      assertPreCommitGuards({
        deadlineMs: Date.now() - 1,
        minFreeBytes: 0,
        outputRoot,
      }),
    (error) => {
      assert.equal(error.code, 'deadline-exceeded');
      return true;
    }
  );
  await assert.doesNotReject(() =>
    assertPreCommitGuards({
      deadlineMs: Date.now() + 60_000,
      minFreeBytes: 0,
      outputRoot,
    })
  );
});

test('assertJobDeadline fails closed past the job budget', () => {
  assert.doesNotThrow(() => assertJobDeadline(Date.now() + 60_000, 'claim'));
  assert.throws(
    () => assertJobDeadline(Date.now() - 1, 'commit'),
    (error) => {
      assert.equal(error.code, 'deadline-exceeded');
      assert.match(error.message, /120000ms budget during commit/);
      return true;
    }
  );
});

test('prepareOwnedStaging creates, reuses owned dirs, and rejects plants', async () => {
  const { outputRoot } = await setup();
  const token = 'recovery-run-token-1';
  const first = await prepareOwnedStaging(outputRoot, token);
  // Crash-recovery reruns find their own directory: EEXIST verifies.
  assert.equal(await prepareOwnedStaging(outputRoot, token), first);
  // A pre-planted symlink (token visible in the published claim) must
  // fail instead of being followed by recursive creation.
  const evil = join(outputRoot, 'staging-evil-token-2');
  await symlink(tmpdir(), evil);
  await assert.rejects(
    () => prepareOwnedStaging(outputRoot, 'evil-token-2'),
    (error) => {
      assert.equal(error.code, 'unsafe-staging-directory');
      return true;
    }
  );
  // A planted regular file is not a directory either.
  await writeFile(join(outputRoot, 'staging-file-token-3'), 'x');
  await assert.rejects(
    () => prepareOwnedStaging(outputRoot, 'file-token-3'),
    (error) => {
      assert.equal(error.code, 'unsafe-staging-directory');
      return true;
    }
  );
});

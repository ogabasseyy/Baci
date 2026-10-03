import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertJobDeadline, assertPreCommitGuards } from './generate-job.mjs';

async function setup() {
  const base = join(tmpdir(), `pilot-gen-job-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
  assert.throws(() => assertJobDeadline(Date.now() - 1, 'commit'), (error) => {
    assert.equal(error.code, 'deadline-exceeded');
    assert.match(error.message, /120000ms budget during commit/);
    return true;
  });
});

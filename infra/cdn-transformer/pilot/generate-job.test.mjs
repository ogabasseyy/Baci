import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertJobDeadline,
  assertPreCommitGuards,
  prepareOwnedStaging,
  runJob,
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

test('runJob fails fast when the encoder lock was evicted before the job', async () => {
  const { base } = await setup();
  const evicted = Object.assign(new Error('changed owner mid-run'), {
    code: 'encoder-lock-evicted',
  });
  let released = false;
  // The eviction check runs before any claim, staging, or encode: the
  // job reports failed loudly instead of acting alongside the successor.
  const result = await runJob({
    deps: {
      releaseClaim: async () => {
        released = true;
      },
      removeOwnedStaging: async () => {
        throw new Error('must not stage after eviction');
      },
    },
    encoderLock: {
      assertHeld: async () => {
        throw evicted;
      },
    },
    inputRoot: join(base, 'input'),
    job: {
      assetId: 'evicted-a',
      expectedSha256: '0'.repeat(64),
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      role: 'logo',
      sourcePath: 'evicted-a.png',
    },
    outputRoot: join(base, 'output'),
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'encoder-lock-evicted');
  assert.equal(released, true);
});

test('runJob retries source.snapshot and commit writes when fsync returns EINVAL', async () => {
  const { createHash } = await import('node:crypto');
  const { copyFile, readFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { writeConfinedFile } = await import('./disk-guards.mjs');
  const { base, outputRoot } = await setup();
  const inputRoot = join(base, 'input');
  await mkdir(inputRoot, { recursive: true });
  await mkdir(join(outputRoot, 'claims'), { recursive: true });
  await mkdir(join(outputRoot, 'generations'), { recursive: true });
  const here = dirname(fileURLToPath(import.meta.url));
  const target = join(inputRoot, 'tiny.png');
  await copyFile(join(here, 'fixtures', 'tiny-48x48.png'), target);
  const bytes = await readFile(target);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const calls = [];
  const result = await runJob({
    deps: {
      writeConfinedFile: async (dir, name, content, options) => {
        calls.push({ name, options });
        if (options?.sync !== false) {
          throw Object.assign(new Error('fsync unsupported'), {
            code: 'EINVAL',
          });
        }
        return await writeConfinedFile(dir, name, content, options);
      },
    },
    inputRoot,
    job: {
      assetId: 'tiny-nosync',
      expectedSha256: sha256,
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      role: 'logo',
      sourcePath: 'tiny.png',
    },
    minFreeBytes: 0,
    outputRoot,
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.durability, 'sync-unsupported');
  assert.deepEqual(calls.slice(0, 2), [
    { name: 'source.snapshot', options: undefined },
    { name: 'source.snapshot', options: { sync: false } },
  ]);
});

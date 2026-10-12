import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  cleanupFailedAttempt,
  removeStagingWithRetry,
  sweepOrphanedStaging,
} from './claims-cleanup.mjs';

test('staging removal retries transient failures, then throws', async () => {
  let calls = 0;
  await removeStagingWithRetry('root', 'staging-abc', async () => {
    calls += 1;
    if (calls < 3) {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    }
  });
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(
    () =>
      removeStagingWithRetry('root', 'staging-abc', async () => {
        calls += 1;
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }),
    /denied/
  );
  assert.equal(calls, 3);
});

test('failed attempts record stranded dirs but still release the claim', async () => {
  let released = null;
  const stagingCleanupError = await cleanupFailedAttempt({
    job: { assetId: 'a', merchantId: 'm' },
    outputRoot: 'root',
    releaseClaimFn: async (root, job, runToken) => {
      released = runToken;
    },
    removeStagingFn: async () => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    },
    runToken: 'token-1234',
    stagingDir: join('root', 'staging-token-1234'),
  });
  // The retry still matters on this path (transient EBUSY clears), but
  // a persistent failure records the stranded NAME (not the full path)
  // while the claim releases so the immediate retry can acquire.
  assert.match(stagingCleanupError, /EBUSY/);
  assert.match(stagingCleanupError, /staging-token-1234/);
  assert.doesNotMatch(stagingCleanupError, /root/);
  assert.equal(released, 'token-1234');
});

test('failed attempts with clean removal record nothing', async () => {
  let released = null;
  const stagingCleanupError = await cleanupFailedAttempt({
    job: { assetId: 'a', merchantId: 'm' },
    outputRoot: 'root',
    releaseClaimFn: async (root, job, runToken) => {
      released = runToken;
    },
    removeStagingFn: async () => {},
    runToken: 'token-1234',
    stagingDir: join('root', 'staging-token-1234'),
  });
  assert.equal(stagingCleanupError, null);
  assert.equal(released, 'token-1234');
});

test('sweep reaps only old claimless staging dirs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pilot-sweep-'));
  const old = new Date(Date.now() - 60_000);
  // Old orphan: stranded by a removal failure after its claim released.
  const orphan = join(root, 'staging-orphan12');
  await mkdir(orphan, { recursive: true });
  await writeFile(join(orphan, 'x.bin'), 'x');
  await utimes(orphan, old, old);
  // Fresh orphan: a concurrent release-then-remove window, not reaped.
  const fresh = join(root, 'staging-fresh123');
  await mkdir(fresh, { recursive: true });
  // Live claim: staging referenced by a claim file is never reaped.
  const liveToken = 'live-5678';
  await mkdir(join(root, `staging-${liveToken}`), { recursive: true });
  await mkdir(join(root, 'claims'), { recursive: true });
  await writeFile(
    join(root, 'claims', 'abc.json'),
    JSON.stringify({
      pid: process.pid,
      runToken: liveToken,
      stagingDirName: `staging-${liveToken}`,
    })
  );
  // Non-staging entries and token-misshapen names are ignored.
  await mkdir(join(root, 'generations'), { recursive: true });
  await mkdir(join(root, 'staging-!!'), { recursive: true });
  const reaped = await sweepOrphanedStaging(root);
  assert.deepEqual(reaped, ['staging-orphan12']);
  assert.deepEqual((await readdir(root)).sort(), [
    'claims',
    'generations',
    'staging-!!',
    'staging-fresh123',
    'staging-live-5678',
  ]);
});

test('sweep tolerates missing trees', async () => {
  const root = join(
    await mkdtemp(join(tmpdir(), 'pilot-sweep-')),
    'no-such-root'
  );
  assert.deepEqual(await sweepOrphanedStaging(root), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireEncoderLock } from './encoder-lock.mjs';

async function setupRoot() {
  const outputRoot = join(
    tmpdir(),
    `pilot-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(outputRoot, { recursive: true });
  return outputRoot;
}

// Isolated lock directory per test: the host lock is global by default,
// so suites inject unique dirs and never contend with each other.
async function setupLocks() {
  const locksDir = join(
    tmpdir(),
    `pilot-locks-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(locksDir, { recursive: true });
  return locksDir;
}

function lockPath(locksDir) {
  return join(locksDir, 'encoder.lock');
}

// A pid that is guaranteed dead: a synchronous child that already exited.
function deadPid() {
  const child = spawnSync(process.execPath, ['-e', '']);
  assert.equal(child.status, 0);
  return child.pid;
}

test('acquire, release, and re-acquire are exclusive', async () => {
  const outputRoot = await setupRoot();
  const locksDir = await setupLocks();
  const first = await acquireEncoderLock(outputRoot, { locksDir });
  await assert.rejects(acquireEncoderLock(outputRoot, { locksDir }), /encoder lock/);
  await first.release();
  const second = await acquireEncoderLock(outputRoot, { locksDir });
  await second.release();
  // Idempotent release: no throw, no unlink of a successor's claim.
  await second.release();
});

test('different roots serialize on the shared host lock', async () => {
  // One encoding at a time per host, across all output roots: a second
  // root contending while the first holds fails fast instead of
  // encoding concurrently and contaminating resource evidence.
  const locksDir = await setupLocks();
  const first = await acquireEncoderLock(await setupRoot(), { locksDir });
  await assert.rejects(
    acquireEncoderLock(await setupRoot(), { locksDir }),
    /encoder lock/
  );
  await first.release();
  const second = await acquireEncoderLock(await setupRoot(), { locksDir });
  await second.release();
});

test('isolated lock dirs never contend', async () => {
  const first = await acquireEncoderLock(await setupRoot(), {
    locksDir: await setupLocks(),
  });
  const second = await acquireEncoderLock(await setupRoot(), {
    locksDir: await setupLocks(),
  });
  await first.release();
  await second.release();
});

test('a crashed holder (dead pid) is reclaimed', async () => {
  const outputRoot = await setupRoot();
  const locksDir = await setupLocks();
  await writeFile(
    lockPath(locksDir),
    JSON.stringify({
      pid: deadPid(),
      startedAt: new Date().toISOString(),
      token: 'crashed-holder-token',
    })
  );
  const lock = await acquireEncoderLock(outputRoot, { locksDir });
  await lock.release();
});

test('a live holder is never evicted', async () => {
  const outputRoot = await setupRoot();
  const locksDir = await setupLocks();
  await writeFile(
    lockPath(locksDir),
    JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      token: 'live-holder-token',
    })
  );
  await assert.rejects(acquireEncoderLock(outputRoot, { locksDir }), /encoder lock/);
});

test('shapeless claims fail closed instead of stealing', async () => {
  // Valid JSON without a holder shape ({}, a pid without a token, a
  // token without a pid) is tampering or disk fault — atomic
  // publication means our writer never emits it. The old code read a
  // missing pid as dead and deleted the lock, admitting a second
  // encoder alongside a possibly live original.
  const shapeless = [
    {},
    [],
    { pid: 123456789 },
    { token: 'orphan-token' },
    { pid: '123', token: 'string-pid' },
    { pid: -1, token: 'negative-pid' },
    { pid: 123456789, token: '' },
  ];
  for (const claim of shapeless) {
    const outputRoot = await setupRoot();
    const locksDir = await setupLocks();
    await writeFile(lockPath(locksDir), JSON.stringify(claim));
    await assert.rejects(
      acquireEncoderLock(outputRoot, { locksDir }),
      (error) => {
        assert.equal(error?.code, 'encoder-lock-corrupt');
        return true;
      },
      `claim ${JSON.stringify(claim)} must fail closed`
    );
    // Fail-closed keeps the evidence for the operator: nothing reaped.
    assert.equal(await readFile(lockPath(locksDir), 'utf8'), JSON.stringify(claim));
  }
});

test('a symlinked locks directory is refused, never followed', async () => {
  const outputRoot = await setupRoot();
  const outside = join(outputRoot, 'outside');
  await mkdir(outside, { recursive: true });
  const planted = join(outputRoot, 'locks');
  await symlink(outside, planted);
  await assert.rejects(
    acquireEncoderLock(outputRoot, { locksDir: planted }),
    /confined directory/
  );
});

test('release unlinks only its own claim', async () => {
  const outputRoot = await setupRoot();
  const locksDir = await setupLocks();
  const lock = await acquireEncoderLock(outputRoot, { locksDir });
  // A successor claim lands (simulated handoff): the stale release must
  // not unlink it.
  const path = lockPath(locksDir);
  const successor = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: 'successor-claim',
  });
  await writeFile(path, successor);
  await lock.release();
  assert.equal(await readFile(path, 'utf8'), successor);
});

test('oversized lock records classify corrupt without buffering', async () => {
  // Honest claims are ~100 bytes: a multi-ceiling lock file must fail
  // closed as corrupt instead of exhausting the contender.
  const { MAX_ENCODER_LOCK_BYTES } = await import('./constants.mjs');
  const outputRoot = await setupRoot();
  const locksDir = await setupLocks();
  await writeFile(
    lockPath(locksDir),
    `{"token":"${'x'.repeat(MAX_ENCODER_LOCK_BYTES)}"}`
  );
  await assert.rejects(
    acquireEncoderLock(outputRoot, { locksDir }),
    /encoder-lock-corrupt|is corrupt/
  );
});

test('corrupt claims fail closed at any age, never steal by age', async () => {
  // Publication is atomic (link-or-EEXIST), so a corrupt lock file can
  // never be a holder mid-write — only external tampering. Age is not
  // proof of abandonment: both fresh and ancient garbage fail closed
  // for the operator instead of unlinking a possibly live creator.
  for (const ageMs of [0, 3_600_000]) {
    const outputRoot = await setupRoot();
    const locksDir = await setupLocks();
    await writeFile(lockPath(locksDir), '{partial-write');
    const stamp = new Date(Date.now() - ageMs);
    await utimes(lockPath(locksDir), stamp, stamp);
    await assert.rejects(
      acquireEncoderLock(outputRoot, { locksDir }),
      /encoder-lock-corrupt|is corrupt/
    );
  }
});

test('crashed claim temps never block acquisition', async () => {
  const outputRoot = await setupRoot();
  const locksDir = await setupLocks();
  const orphan = join(locksDir, 'claim-99999999-deadbeef.tmp');
  await writeFile(orphan, JSON.stringify({ pid: 99999999 }));
  const ancient = new Date(Date.now() - 7_200_000);
  await utimes(orphan, ancient, ancient);
  const lock = await acquireEncoderLock(outputRoot, { locksDir });
  await lock.release();
  // The sweep reaps the stale temp best-effort.
  await assert.rejects(readFile(orphan), /ENOENT/);
});

test('assertHeld throws after a steal-race loser displaces the claim', async () => {
  const outputRoot = await setupRoot();
  const locksDir = await setupLocks();
  const holder = await acquireEncoderLock(outputRoot, { locksDir });
  await holder.assertHeld();
  // A steal-race loser renames the live claim away (believing it stale)
  // and a newcomer publishes a replacement on the freed path: the
  // displaced holder must detect that before its next encode instead of
  // encoding concurrently with the successor.
  const path = lockPath(locksDir);
  await rename(path, `${path}.stolen`);
  const successor = await acquireEncoderLock(outputRoot, { locksDir });
  await assert.rejects(holder.assertHeld(), /changed owner mid-run/);
  await holder.release();
  // The displaced release must not unlink the successor's claim.
  await successor.assertHeld();
  await assert.rejects(acquireEncoderLock(outputRoot, { locksDir }), /encoder lock/);
  await successor.release();
  // After the holder's own release the claim is gone: still held is false.
  await assert.rejects(successor.assertHeld(), /changed owner mid-run/);
});

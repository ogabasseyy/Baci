import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, symlink, utimes, writeFile } from 'node:fs/promises';
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

function lockPath(outputRoot) {
  return join(outputRoot, 'locks', 'encoder.lock');
}

// A pid that is guaranteed dead: a synchronous child that already exited.
function deadPid() {
  const child = spawnSync(process.execPath, ['-e', '']);
  assert.equal(child.status, 0);
  return child.pid;
}

test('acquire, release, and re-acquire are exclusive', async () => {
  const outputRoot = await setupRoot();
  const first = await acquireEncoderLock(outputRoot);
  await assert.rejects(acquireEncoderLock(outputRoot), /encoder lock/);
  await first.release();
  const second = await acquireEncoderLock(outputRoot);
  await second.release();
  // Idempotent release: no throw, no unlink of a successor's claim.
  await second.release();
});

test('a second root locks independently', async () => {
  const first = await acquireEncoderLock(await setupRoot());
  const second = await acquireEncoderLock(await setupRoot());
  await first.release();
  await second.release();
});

test('a crashed holder (dead pid) is reclaimed', async () => {
  const outputRoot = await setupRoot();
  await mkdir(join(outputRoot, 'locks'), { recursive: true });
  await writeFile(
    lockPath(outputRoot),
    JSON.stringify({ pid: deadPid(), startedAt: new Date().toISOString() })
  );
  const lock = await acquireEncoderLock(outputRoot);
  await lock.release();
});

test('a live holder is never evicted', async () => {
  const outputRoot = await setupRoot();
  await mkdir(join(outputRoot, 'locks'), { recursive: true });
  await writeFile(
    lockPath(outputRoot),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
  );
  await assert.rejects(acquireEncoderLock(outputRoot), /encoder lock/);
});

test('a symlinked locks directory is refused, never followed', async () => {
  const outputRoot = await setupRoot();
  const outside = join(outputRoot, 'outside');
  await mkdir(outside, { recursive: true });
  await symlink(outside, join(outputRoot, 'locks'));
  await assert.rejects(acquireEncoderLock(outputRoot), /confined directory/);
});

test('release unlinks only its own claim', async () => {
  const outputRoot = await setupRoot();
  const lock = await acquireEncoderLock(outputRoot);
  // A successor claim lands (simulated handoff): the stale release must
  // not unlink it.
  const path = lockPath(outputRoot);
  const successor = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: 'successor-claim',
  });
  await writeFile(path, successor);
  await lock.release();
  assert.equal(await readFile(path, 'utf8'), successor);
});

test('corrupt claims fail closed at any age, never steal by age', async () => {
  // Publication is atomic (link-or-EEXIST), so a corrupt lock file can
  // never be a holder mid-write — only external tampering. Age is not
  // proof of abandonment: both fresh and ancient garbage fail closed
  // for the operator instead of unlinking a possibly live creator.
  for (const ageMs of [0, 3_600_000]) {
    const outputRoot = await setupRoot();
    await mkdir(join(outputRoot, 'locks'), { recursive: true });
    await writeFile(lockPath(outputRoot), '{partial-write');
    const stamp = new Date(Date.now() - ageMs);
    await utimes(lockPath(outputRoot), stamp, stamp);
    await assert.rejects(
      acquireEncoderLock(outputRoot),
      /encoder-lock-corrupt|is corrupt/
    );
  }
});

test('crashed claim temps never block acquisition', async () => {
  const outputRoot = await setupRoot();
  await mkdir(join(outputRoot, 'locks'), { recursive: true });
  const orphan = join(outputRoot, 'locks', 'claim-99999999-deadbeef.tmp');
  await writeFile(orphan, JSON.stringify({ pid: 99999999 }));
  const ancient = new Date(Date.now() - 7_200_000);
  await utimes(orphan, ancient, ancient);
  const lock = await acquireEncoderLock(outputRoot);
  await lock.release();
  // The sweep reaps the stale temp best-effort.
  await assert.rejects(readFile(orphan), /ENOENT/);
});

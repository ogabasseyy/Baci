import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
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

test('corrupt claims steal only past the grace window', async () => {
  const fresh = await setupRoot();
  await mkdir(join(fresh, 'locks'), { recursive: true });
  await writeFile(lockPath(fresh), '{partial-write');
  // Fresh garbage may be a holder mid-write: refuse, never unlink.
  await assert.rejects(acquireEncoderLock(fresh), /encoder lock/);
  const aged = await setupRoot();
  await mkdir(join(aged, 'locks'), { recursive: true });
  await writeFile(lockPath(aged), '{partial-write');
  const ancient = new Date(Date.now() - 60_000);
  await utimes(lockPath(aged), ancient, ancient);
  const lock = await acquireEncoderLock(aged);
  await lock.release();
});

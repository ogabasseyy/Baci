import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquireEncoderLock } from './encoder-lock.mjs';

async function setupRoot() {
  const outputRoot = join(
    tmpdir(),
    `pilot-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(outputRoot, { recursive: true });
  return outputRoot;
}

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

test('release propagates non-ENOENT failures and stays retryable', async (t) => {
  // POSIX-only (permission bits do not bind root or Windows): with the
  // locks dir unwritable, the release rename fails EACCES. The old
  // blanket catch reported success while the lock stayed live, so a
  // later run saw the still-live PID and refused to start.
  if (typeof process.getuid !== 'function' || process.getuid() === 0) {
    t.skip('requires POSIX permission enforcement');
    return;
  }
  const { chmod } = await import('node:fs/promises');
  const outputRoot = await setupRoot();
  const locksDir = await setupLocks();
  const lock = await acquireEncoderLock(outputRoot, { locksDir });
  await chmod(locksDir, 0o555);
  try {
    await assert.rejects(() => lock.release(), /EACCES/);
  } finally {
    await chmod(locksDir, 0o755);
  }
  // Still held and still ours: the claim survives, and a retry after
  // permissions heal releases it normally — a fresh run then starts
  // instead of refusing on a zombie live PID.
  const claim = JSON.parse(await readFile(lockPath(locksDir), 'utf8'));
  assert.equal(claim.pid, process.pid);
  await lock.assertHeld();
  await lock.release();
  await assert.rejects(() => readFile(lockPath(locksDir)), /ENOENT/);
  const next = await acquireEncoderLock(outputRoot, { locksDir });
  await next.release();
});

import assert from 'node:assert/strict';
import { constants as fsConstants } from 'node:fs';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertMinFreeBytes,
  createStagingBudget,
  fsyncDir,
  getAvailableBytes,
  GUARDED_READ_FLAGS,
  isUnsupportedSyncError,
  readUpToBytes,
  removeOwnedStaging,
  sha256File,
  writeConfinedFile,
} from './disk-guards.mjs';

test('reports available bytes and enforces the free-space floor', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pilot-disk-'));
  const available = await getAvailableBytes(dir);
  assert.ok(available > 0);
  await assertMinFreeBytes(dir, 1);
  await assert.rejects(
    () => assertMinFreeBytes(dir, Number.MAX_SAFE_INTEGER),
    /free space/
  );
  await assert.rejects(
    () => getAvailableBytes(join(dir, 'missing')),
    /accessible/
  );
});

test('staging budget charges bytes up to the cap', () => {
  const budget = createStagingBudget(100);
  budget.charge(60);
  assert.equal(budget.used, 60);
  budget.charge(40);
  assert.equal(budget.used, 100);
  assert.throws(() => budget.charge(1), /staging cap/);
  assert.throws(() => budget.charge(-1), /negative/);
});

test('removeOwnedStaging removes only owned staging directories', async () => {
  const base = await mkdtemp(join(tmpdir(), 'pilot-staging-'));
  const owned = join(base, 'staging-abc123');
  await mkdir(owned, { recursive: true });
  await writeFile(join(owned, 'tier-384.avif'), Buffer.alloc(16));
  await removeOwnedStaging(base, owned);
  await assert.rejects(() => removeOwnedStaging(base, owned), /missing/);

  const outside = await mkdtemp(join(tmpdir(), 'pilot-outside-'));
  const foreign = join(outside, 'staging-xyz');
  await mkdir(foreign, { recursive: true });
  await assert.rejects(() => removeOwnedStaging(base, foreign), /escapes/);

  const impostor = join(base, 'not-staging');
  await mkdir(impostor, { recursive: true });
  await assert.rejects(() => removeOwnedStaging(base, impostor), /owned/);

  const nested = join(base, 'staging-nested', 'inner');
  await mkdir(nested, { recursive: true });
  await assert.rejects(() => removeOwnedStaging(base, nested), /owned/);
});

test('removeOwnedStaging refuses a symlink to a sibling staging directory', async () => {
  const { lstat, readFile, symlink } = await import('node:fs/promises');
  const base = await mkdtemp(join(tmpdir(), 'pilot-staging-link-'));
  const sibling = join(base, 'staging-sibling1');
  await mkdir(sibling, { recursive: true });
  await writeFile(join(sibling, 'sentinel.txt'), 'other run bytes');
  // The caller's own name is a link at a valid owned path: realpath
  // resolves the sibling and the parent/prefix checks would pass, so
  // only the lstat gate keeps rm from deleting the other run's tree.
  const link = join(base, 'staging-mine1234');
  await symlink(sibling, link);
  await assert.rejects(() => removeOwnedStaging(base, link), /not a directory/);
  assert.equal(
    await readFile(join(sibling, 'sentinel.txt'), 'utf8'),
    'other run bytes'
  );
  assert.equal((await lstat(link)).isSymbolicLink(), true);
});

test('readUpToBytes caps allocation at the claim plus one byte', async () => {
  const base = await mkdtemp(join(tmpdir(), 'pilot-read-capped-'));
  const small = join(base, 'small.bin');
  await writeFile(small, Buffer.from('0123456789'));
  assert.deepEqual(await readUpToBytes(small, 10), {
    bytes: Buffer.from('0123456789'),
    truncated: false,
  });
  assert.deepEqual(await readUpToBytes(small, 4), {
    bytes: Buffer.from('0123'),
    truncated: true,
  });
  // Exact-boundary: claim+1 bytes on disk fills the probe without
  // truncation, and short content never over-reports.
  const edge = join(base, 'edge.bin');
  await writeFile(edge, Buffer.from('01234'));
  assert.deepEqual(await readUpToBytes(edge, 4), {
    bytes: Buffer.from('0123'),
    truncated: true,
  });
  assert.deepEqual(await readUpToBytes(edge, 5), {
    bytes: Buffer.from('01234'),
    truncated: false,
  });
  await assert.rejects(() => readUpToBytes(join(base, 'missing.bin'), 10));
});

test('readUpToBytes refuses a symlink swapped in for guarded bytes', async (t) => {
  if (process.platform === 'win32') {
    t.skip('O_NOFOLLOW degrades to plain read on Windows');
    return;
  }
  // The flag bits are pinned directly: a revert to plain 'r' would
  // pass every bytes test while reopening the read-through-link hole.
  assert.equal(
    GUARDED_READ_FLAGS & fsConstants.O_NOFOLLOW,
    fsConstants.O_NOFOLLOW
  );
  assert.equal(
    GUARDED_READ_FLAGS & fsConstants.O_NONBLOCK,
    fsConstants.O_NONBLOCK
  );
  const base = await mkdtemp(join(tmpdir(), 'pilot-read-link-'));
  const target = join(base, 'target.bin');
  await writeFile(target, Buffer.from('elsewhere'));
  const link = join(base, 'guarded.bin');
  await symlink(target, link);
  await assert.rejects(() => readUpToBytes(link, 1024), /ELOOP/);
});

test('readUpToBytes refuses a FIFO without hanging the open', async (t) => {
  if (process.platform === 'win32') {
    t.skip('mkfifo exists only on POSIX');
    return;
  }
  // A blocking open would hang this test past every timeout instead
  // of rejecting: O_NONBLOCK keeps the open instant and the fstat
  // gate refuses the non-file before the first read.
  const { execFileSync } = await import('node:child_process');
  const base = await mkdtemp(join(tmpdir(), 'pilot-read-fifo-'));
  const fifo = join(base, 'guarded.bin');
  execFileSync('mkfifo', [fifo]);
  await assert.rejects(() => readUpToBytes(fifo, 1024), /refusing to read/);
});

test('readUpToBytes streams multi-chunk files to the cap', async () => {
  const base = await mkdtemp(join(tmpdir(), 'pilot-read-chunked-'));
  const big = join(base, 'big.bin');
  const payload = Buffer.alloc(200 * 1024);
  for (let i = 0; i < payload.length; i += 1) {
    payload[i] = i % 251;
  }
  await writeFile(big, payload);
  // Under the cap: full content across chunk boundaries.
  assert.deepEqual(await readUpToBytes(big, 300 * 1024), {
    bytes: payload,
    truncated: false,
  });
  // Over the cap: exactly cap bytes plus the truncation signal.
  const capped = await readUpToBytes(big, 100 * 1024);
  assert.equal(capped.truncated, true);
  assert.deepEqual(capped.bytes, payload.subarray(0, 100 * 1024));
});

test('sha256File hashes in constant memory, identical to a buffered hash', async () => {
  const { createHash } = await import('node:crypto');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-disk-'));
  const target = join(dir, 'multi-chunk.bin');
  // Multi-chunk payload so the test crosses stream boundaries.
  const payload = Buffer.alloc(300 * 1024, 0);
  for (let i = 0; i < payload.length; i += 4096) {
    payload[i] = i % 251;
  }
  await writeFile(target, payload);
  const expected = createHash('sha256').update(payload).digest('hex');
  assert.equal(await sha256File(target), expected);
  // Read errors propagate raw, like readFile's: callers map them.
  await assert.rejects(() => sha256File(join(dir, 'missing')), /ENOENT/);
});

test('fsyncDir syncs a directory entry and rejects a missing path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pilot-fsync-'));
  await fsyncDir(dir);
  await assert.rejects(() => fsyncDir(join(dir, 'missing')), /ENOENT/);
});

test('isUnsupportedSyncError classifies only unsupported sync', () => {
  assert.equal(isUnsupportedSyncError({ code: 'ENOSYS' }), true);
  assert.equal(isUnsupportedSyncError({ code: 'EINVAL' }), true);
  assert.equal(isUnsupportedSyncError({ code: 'EIO' }), false);
  assert.equal(isUnsupportedSyncError({ code: 'ENOSPC' }), false);
  assert.equal(isUnsupportedSyncError(undefined), false);
});

test('writeConfinedFile publishes exclusively inside the checked parent', async () => {
  const { readFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-confined-'));
  await writeConfinedFile(dir, 'source.snapshot', Buffer.from('frozen'));
  assert.equal(
    await readFile(join(dir, 'source.snapshot'), 'utf8'),
    'frozen'
  );
  // Exclusive: a second freeze at the same name refuses, never overwrites.
  await assert.rejects(
    () => writeConfinedFile(dir, 'source.snapshot', Buffer.from('again')),
    /EEXIST/
  );
});

test('writeConfinedFile sync:false still confines and rebinds', async () => {
  // Degraded-durability path: no fsync, but the exclusive create and
  // the post-close identity rebind hold exactly as in the synced path.
  const { readFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-confined-nosync-'));
  await writeConfinedFile(dir, 'report.json', Buffer.from('marked'), {
    sync: false,
  });
  assert.equal(await readFile(join(dir, 'report.json'), 'utf8'), 'marked');
  await assert.rejects(
    () =>
      writeConfinedFile(dir, 'report.json', Buffer.from('again'), {
        sync: false,
      }),
    /EEXIST/
  );
});

test('writeConfinedFile refuses a parent swapped for a symlink', async () => {
  // A staging parent renamed away and replaced with a link after setup:
  // 'wx' alone would create through the link outside the owned tree.
  const { lstat, readdir, rename, symlink } = await import(
    'node:fs/promises'
  );
  const root = await mkdtemp(join(tmpdir(), 'pilot-confined-swap-'));
  const dir = join(root, 'staging-x');
  await mkdir(dir);
  const outside = join(root, 'outside');
  await mkdir(outside);
  await rename(dir, join(root, 'staging-x-moved'));
  await symlink(outside, dir);
  await assert.rejects(
    () => writeConfinedFile(dir, 'source.snapshot', Buffer.from('frozen')),
    /not a directory/
  );
  assert.deepEqual(await readdir(outside), []);
  assert.equal((await lstat(dir)).isSymbolicLink(), true);
});

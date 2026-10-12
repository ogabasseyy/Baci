import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertMinFreeBytes,
  createStagingBudget,
  fsyncDir,
  getAvailableBytes,
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

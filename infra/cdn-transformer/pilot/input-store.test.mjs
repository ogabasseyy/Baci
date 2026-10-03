import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readInputSnapshot,
  resolveExistingInputPath,
  resolveNewSnapshotPath,
  snapshotNameForAsset,
  verifySnapshotHash,
} from './input-store.mjs';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function makeRoots() {
  const base = await mkdtemp(join(tmpdir(), 'pilot-input-'));
  const root = join(base, 'input');
  const outside = join(base, 'outside');
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  return { base, outside, root };
}

test('reads an existing snapshot with its content hash', async () => {
  const { root } = await makeRoots();
  await mkdir(join(root, 'snapshots'), { recursive: true });
  await writeFile(join(root, 'snapshots', 'a.png'), PNG_BYTES);
  const snapshot = await readInputSnapshot(root, 'snapshots/a.png');
  assert.equal(snapshot.sha256, sha256(PNG_BYTES));
  assert.equal(snapshot.size, PNG_BYTES.length);
  assert.deepEqual(snapshot.bytes, PNG_BYTES);
});

test('rejects missing files and directories', async () => {
  const { root } = await makeRoots();
  await assert.rejects(() => readInputSnapshot(root, 'nope.png'));
  await mkdir(join(root, 'subdir'));
  await assert.rejects(() => readInputSnapshot(root, 'subdir'));
});

test('rejects symlinks escaping the input root', async () => {
  const { outside, root } = await makeRoots();
  const secret = join(outside, 'secret.png');
  await writeFile(secret, PNG_BYTES);
  await symlink(secret, join(root, 'escape.png'));
  await assert.rejects(
    () => resolveExistingInputPath(root, 'escape.png'),
    /escapes/
  );
  await assert.rejects(() => readInputSnapshot(root, 'escape.png'), /escapes/);
});

test('rejects symlinked subdirectories escaping the root', async () => {
  const { outside, root } = await makeRoots();
  await writeFile(join(outside, 'evil.png'), PNG_BYTES);
  await symlink(outside, join(root, 'linked'));
  await assert.rejects(
    () => readInputSnapshot(root, 'linked/evil.png'),
    /escapes/
  );
});

test('rejects oversized input', async () => {
  const { root } = await makeRoots();
  const big = Buffer.alloc(10 * 1024 * 1024 + 1, 7);
  await writeFile(join(root, 'big.png'), big);
  await assert.rejects(() => readInputSnapshot(root, 'big.png'), /too large/);
});

test('verifySnapshotHash detects source mutation', async () => {
  const { root } = await makeRoots();
  await writeFile(join(root, 'a.png'), PNG_BYTES);
  const before = await readInputSnapshot(root, 'a.png');
  assert.equal(verifySnapshotHash(before, sha256(PNG_BYTES)), true);
  await writeFile(join(root, 'a.png'), Buffer.from('mutated'));
  const after = await readInputSnapshot(root, 'a.png');
  assert.equal(verifySnapshotHash(after, before.sha256), false);
});

test('snapshotNameForAsset builds merchant-scoped flat filenames', () => {
  const merchant = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  assert.equal(
    snapshotNameForAsset(merchant, 'logo-1', 'png'),
    `${merchant}-logo-1.png`
  );
  assert.throws(() => snapshotNameForAsset(merchant, '../x', 'png'), /asset/);
  assert.throws(() => snapshotNameForAsset(merchant, 'a', 'svg'), /extension/);
  assert.throws(() => snapshotNameForAsset('not-a-uuid', 'a', 'png'), /merchant/);
  assert.throws(
    () => snapshotNameForAsset(merchant, 'a'.repeat(128), 'png'),
    /limit|too long/i
  );
});

test('resolveNewSnapshotPath refuses symlink squatting', async () => {
  const { outside, root } = await makeRoots();
  const { realpath } = await import('node:fs/promises');
  const target = await resolveNewSnapshotPath(root, 'fresh.png');
  assert.equal(target, join(await realpath(root), 'fresh.png'));
  await symlink(join(outside, 'x.png'), join(root, 'squat.png'));
  await assert.rejects(() => resolveNewSnapshotPath(root, 'squat.png'));
  await assert.rejects(() => resolveNewSnapshotPath(root, '../evil.png'));
});

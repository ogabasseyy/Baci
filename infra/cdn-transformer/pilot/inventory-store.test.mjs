import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

test('appendInventoryRecord rejects route-rejected duplicates', async () => {
  const { appendInventoryRecord } = await import('./inventory-store.mjs');
  const { writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-append-'));
  const path = join(dir, 'inventory.json');
  const sha = createHash('sha256').update('x').digest('hex');
  const record = (overrides = {}) => ({
    assetId: 'logo-a',
    merchantId: MERCHANT,
    role: 'logo',
    schemaVersion: 1,
    sha256: sha,
    slot: 'header-logo',
    sourcePath: 'snapshots/logo-a.png',
    url: 'https://cdn.example.com/media/logo-a.png',
    ...overrides,
  });
  await writeFile(path, JSON.stringify([record()]));
  await assert.rejects(
    () => appendInventoryRecord(path, record({ assetId: 'logo-b' })),
    /duplicate slot/
  );
  // Same merchant + asset under a different role/slot: the job key
  // (merchant/asset/role) differs, so only the route-parity check catches it.
  await assert.rejects(
    () =>
      appendInventoryRecord(
        path,
        record({ role: 'product', slot: 'product-card' })
      ),
    /duplicate asset/
  );
  const count = await appendInventoryRecord(
    path,
    record({ assetId: 'card-a', slot: 'product-card' })
  );
  assert.equal(count, 2);
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(stored.length, 2);
});

test('isStaleInventoryLock recovers ownerless locks past the creation grace', async () => {
  const { mkdir, utimes } = await import('node:fs/promises');
  const { isStaleInventoryLock } = await import('./inventory-store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-lock-'));
  // Fresh ownerless dir: a holder is mid-acquire, not stale.
  const fresh = join(dir, 'fresh.lock');
  await mkdir(fresh);
  assert.equal(await isStaleInventoryLock(fresh), false);
  // Aged ownerless dir: the holder crashed between mkdir and the owner
  // write — recoverable like any other stale lock.
  const aged = join(dir, 'aged.lock');
  await mkdir(aged);
  const past = new Date(Date.now() - 30_000);
  await utimes(aged, past, past);
  assert.equal(await isStaleInventoryLock(aged), true);
  // Missing dir (raced with a release): not stale; the loop retries.
  assert.equal(await isStaleInventoryLock(join(dir, 'gone.lock')), false);
});

test('appendInventoryRecord recovers a crashed ownerless lock', async () => {
  const { mkdir, utimes } = await import('node:fs/promises');
  const { appendInventoryRecord } = await import('./inventory-store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-append-lock-'));
  const path = join(dir, 'inventory.json');
  await writeFile(path, JSON.stringify([]));
  const lockDir = `${path}.lock`;
  await mkdir(lockDir);
  const past = new Date(Date.now() - 30_000);
  await utimes(lockDir, past, past);
  const sha = createHash('sha256').update('x').digest('hex');
  const count = await appendInventoryRecord(path, {
    assetId: 'logo-a',
    merchantId: MERCHANT,
    role: 'logo',
    schemaVersion: 1,
    sha256: sha,
    slot: 'header-logo',
    sourcePath: 'snapshots/logo-a.png',
    url: 'https://cdn.example.com/media/logo-a.png',
  });
  assert.equal(count, 1);
});

test('serializes concurrent inventory appends without loss', async () => {
  const { appendInventoryRecord } = await import('./inventory-store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-append-race-'));
  const path = join(dir, 'inventory.json');
  const sha = createHash('sha256').update('x').digest('hex');
  const record = (n) => ({
    assetId: `card-${n}`,
    merchantId: MERCHANT,
    role: 'logo',
    schemaVersion: 1,
    sha256: sha,
    slot: `slot-${n}`,
    sourcePath: `snapshots/card-${n}.png`,
    url: `https://cdn.example.com/media/card-${n}.png`,
  });
  const counts = await Promise.all(
    [0, 1, 2, 3].map((n) => appendInventoryRecord(path, record(n)))
  );
  assert.deepEqual([...counts].sort(), [1, 2, 3, 4]);
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(stored.length, 4);
  // No lock debris or temp fragments remain beside the inventory.
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(dir), ['inventory.json']);
});

test('releaseInventoryLock removes only its own owner token', async () => {
  const { mkdir, readdir, writeFile: write } = await import('node:fs/promises');
  const { releaseInventoryLock } = await import('./inventory-store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-release-'));
  const lockDir = join(dir, 'inventory.json.lock');
  await mkdir(lockDir);
  await write(
    join(lockDir, 'owner.json'),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token: 'token-b' })
  );
  // A stale victim releasing with its own (superseded) token must not
  // delete the replacement lock.
  await releaseInventoryLock(lockDir, 'token-a');
  assert.deepEqual(await readdir(lockDir), ['owner.json']);
  // The current owner releases normally.
  await releaseInventoryLock(lockDir, 'token-b');
  await assert.rejects(() => readdir(lockDir));
  // Releasing an already-gone lock is a no-op, never a crash.
  await releaseInventoryLock(lockDir, 'token-b');
});

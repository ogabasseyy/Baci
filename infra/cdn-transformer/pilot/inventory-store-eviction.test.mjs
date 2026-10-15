import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

test('withInventoryLock throws evicted when the lock is replaced mid-section', async () => {
  const { mkdir, rename, rm } = await import('node:fs/promises');
  const { withInventoryLock } = await import('./inventory-append.mjs');
  const { PilotInventoryEvictedError } = await import('./inventory-store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-evict-'));
  const lockDir = join(dir, 'inventory.json.lock');
  await assert.rejects(
    () =>
      withInventoryLock(lockDir, async () => {
        // A steal-race loser renames our live lock away and a newcomer
        // publishes a replacement: the section ran concurrently, so it
        // must fail loudly instead of trusting its outcome.
        await rename(lockDir, `${lockDir}.stolen`);
        await rm(`${lockDir}.stolen`, { force: true, recursive: true });
        await mkdir(lockDir);
        await writeFile(
          join(lockDir, 'owner.json'),
          JSON.stringify({
            pid: process.pid,
            startedAt: new Date().toISOString(),
            token: 'newcomer',
          })
        );
        return 'section-result';
      }),
    (error) => {
      assert.ok(error instanceof PilotInventoryEvictedError);
      assert.match(error.message, /changed owner during the critical section/);
      return true;
    }
  );
  // The evicted section's release must not delete the newcomer's lock.
  const live = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8'));
  assert.equal(live.token, 'newcomer');
});

test('assertInventoryLockHeld passes while held and throws after release', async () => {
  const {
    acquireInventoryLock,
    assertInventoryLockHeld,
    releaseInventoryLock,
  } = await import('./inventory-store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-held-'));
  const lockDir = join(dir, 'inventory.json.lock');
  const token = await acquireInventoryLock(lockDir);
  await assertInventoryLockHeld(lockDir, token);
  await assert.rejects(
    () => assertInventoryLockHeld(lockDir, 'someone-else'),
    /changed owner during the critical section/
  );
  await releaseInventoryLock(lockDir, token);
  await assert.rejects(
    () => assertInventoryLockHeld(lockDir, token),
    /changed owner during the critical section/
  );
});

test('appendInventoryRecord refuses to publish when evicted before the rename', async () => {
  const { appendInventoryRecord } = await import('./inventory-append.mjs');
  const { PilotInventoryEvictedError } = await import('./inventory-store.mjs');
  const { mkdir, readdir, rename, rm } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-prepublish-'));
  const path = join(dir, 'inventory.json');
  const sha = createHash('sha256').update('x').digest('hex');
  const record = (assetId, slot) => ({
    assetId,
    merchantId: MERCHANT,
    role: 'logo',
    schemaVersion: 1,
    sha256: sha,
    slot,
    sourcePath: `snapshots/${assetId}.png`,
    url: `https://cdn.example.com/media/${assetId}.png`,
  });
  await writeFile(path, JSON.stringify([record('logo-a', 'header-logo')]));
  const lockDir = `${path}.lock`;
  await assert.rejects(
    () =>
      appendInventoryRecord(path, record('card-b', 'product-card'), {
        beforeAppend: async () => {
          // A steal-race loser renames the victim's live lock away and a
          // rival publishes on the same base, then releases: the victim
          // must refuse its rename instead of clobbering the rival.
          await rename(lockDir, `${lockDir}.stolen`);
          await rm(`${lockDir}.stolen`, { force: true, recursive: true });
          await mkdir(lockDir);
          await writeFile(
            join(lockDir, 'owner.json'),
            JSON.stringify({
              pid: process.pid,
              startedAt: new Date().toISOString(),
              token: 'rival',
            })
          );
          await writeFile(
            path,
            JSON.stringify([
              record('logo-a', 'header-logo'),
              record('hero-c', 'mobile-hero-slide-0'),
            ])
          );
          await rm(lockDir, { force: true, recursive: true });
        },
      }),
    (error) => {
      assert.ok(error instanceof PilotInventoryEvictedError);
      assert.match(error.message, /changed owner during the critical section/);
      return true;
    }
  );
  // The rival's publish stands: no clobber, no partial victim write.
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(
    stored.map((entry) => entry.assetId),
    ['logo-a', 'hero-c']
  );
  // The refused tmp is cleaned, not littered.
  assert.deepEqual(await readdir(dir), ['inventory.json']);
});

test('appendInventoryRecord syncs the inventory directory after publish', async () => {
  const { appendInventoryRecord } = await import('./inventory-append.mjs');
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
  const dir = await mkdtemp(join(tmpdir(), 'pilot-append-sync-'));
  const path = join(dir, 'inventory.json');
  await writeFile(path, JSON.stringify([record()]));
  const synced = [];
  const count = await appendInventoryRecord(
    path,
    record({ assetId: 'card-a', slot: 'product-card' }),
    {
      fsyncDir: (target) => {
        synced.push(target);
      },
    }
  );
  assert.equal(count, 2);
  assert.deepEqual(synced, [dir]);
  // A real directory-sync failure throws loudly after the publish (the
  // record stays published) and the operator reconciles.
  const failingDir = await mkdtemp(join(tmpdir(), 'pilot-append-sync-fail-'));
  const failingPath = join(failingDir, 'inventory.json');
  const error = new Error('sync failed');
  error.code = 'EIO';
  await assert.rejects(
    () =>
      appendInventoryRecord(failingPath, record(), {
        fsyncDir: () => {
          throw error;
        },
      }),
    /inventory directory sync failed \(EIO\)/
  );
  const stored = JSON.parse(await readFile(failingPath, 'utf8'));
  assert.equal(stored.length, 1);
  // Platforms without sync support proceed, matching the generation
  // store's downgrade philosophy.
  const plainDir = await mkdtemp(join(tmpdir(), 'pilot-append-sync-plain-'));
  const plainPath = join(plainDir, 'inventory.json');
  const enosys = new Error('not supported');
  enosys.code = 'ENOSYS';
  const plainCount = await appendInventoryRecord(plainPath, record(), {
    fsyncDir: () => {
      throw enosys;
    },
  });
  assert.equal(plainCount, 1);
});

test('appendInventoryRecord refuses a publish that would exceed the ceiling', async () => {
  const { appendInventoryRecord } = await import('./inventory-append.mjs');
  const { MAX_INVENTORY_BYTES } = await import('./constants.mjs');
  const sha = createHash('sha256').update('x').digest('hex');
  // A valid record carrying a giant operator annotation would push the
  // serialized inventory over MAX_INVENTORY_BYTES, and publishing it
  // would brick every future append on the stuck over-ceiling read.
  const record = {
    assetId: 'bulk-0',
    merchantId: MERCHANT,
    role: 'logo',
    schemaVersion: 1,
    sha256: sha,
    slot: 'bulk-slot-0',
    sourcePath: 'snapshots/bulk-0.png',
    url: 'https://cdn.example.com/media/bulk-0.png',
  };
  const dir = await mkdtemp(join(tmpdir(), 'pilot-append-ceiling-'));
  const path = join(dir, 'inventory.json');
  await writeFile(path, JSON.stringify([record]));
  const before = await readFile(path, 'utf8');
  assert.ok(Buffer.byteLength(before, 'utf8') < MAX_INVENTORY_BYTES);
  await assert.rejects(
    () =>
      appendInventoryRecord(path, {
        ...record,
        assetId: 'bulk-1',
        note: 'x'.repeat(MAX_INVENTORY_BYTES),
        slot: 'bulk-slot-1',
        sourcePath: 'snapshots/bulk-1.png',
        url: 'https://cdn.example.com/media/bulk-1.png',
      }),
    new RegExp(`inventory would exceed ${MAX_INVENTORY_BYTES} bytes`)
  );
  // The refusal happens before any write: the previous publish is
  // intact for the operator to trim.
  assert.equal(await readFile(path, 'utf8'), before);
});

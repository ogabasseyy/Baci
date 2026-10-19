import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

test('serializes concurrent inventory appends without loss', async () => {
  const { appendInventoryRecord } = await import('./inventory-append.mjs');
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

test('appendInventoryRecord atomically steals a stale owned lock', async () => {
  const { mkdir, readdir, writeFile: write } = await import('node:fs/promises');
  const { appendInventoryRecord } = await import('./inventory-append.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-steal-'));
  const path = join(dir, 'inventory.json');
  await writeFile(path, JSON.stringify([]));
  // Crashed holder: ancient owner with a dead pid.
  const lockDir = `${path}.lock`;
  await mkdir(lockDir);
  await write(
    join(lockDir, 'owner.json'),
    JSON.stringify({
      pid: 999_999_999,
      startedAt: new Date(Date.now() - 300_000).toISOString(),
      token: 'dead-holder',
    })
  );
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
  // The steal renames before removing, so neither the live lock nor
  // steal debris remains beside the inventory.
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
    JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      token: 'token-b',
    })
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

test('acquireInventoryLock revalidates its claim after the owner write', async () => {
  const { mkdir, rename, writeFile: write } = await import('node:fs/promises');
  const { acquireInventoryLock, releaseInventoryLock } = await import(
    './inventory-store.mjs'
  );
  const dir = await mkdtemp(join(tmpdir(), 'pilot-revalidate-'));
  const lockDir = join(dir, 'inventory.json.lock');
  // A stealer that renames our fresh directory away between our owner
  // write and our entry (partial owner observed past the grace): our
  // bytes land in the deleted directory while the live path certifies
  // the replacement. The intruder is already dead so the retry steals
  // it back instead of wedging the test on the live-pid wait.
  let fired = false;
  const token = await acquireInventoryLock(lockDir, {
    afterOwnerWrite: async () => {
      if (fired) {
        return;
      }
      fired = true;
      await rename(lockDir, `${lockDir}.stolen`);
      await mkdir(lockDir);
      await write(
        join(lockDir, 'owner.json'),
        JSON.stringify({
          pid: 999_999_999,
          startedAt: new Date().toISOString(),
          token: 'intruder',
        })
      );
    },
  });
  // The returned claim must match the live owner record: entering on the
  // displaced write's success would run two critical sections at once.
  const live = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8'));
  assert.equal(live.token, token);
  assert.notEqual(token, 'intruder');
  await releaseInventoryLock(lockDir, token);
});

test('acquireInventoryLock restores a rival replacement caught by the steal rename', async () => {
  const {
    mkdir,
    readdir,
    rename,
    rm,
    writeFile: write,
  } = await import('node:fs/promises');
  const { acquireInventoryLock, releaseInventoryLock } = await import(
    './inventory-store.mjs'
  );
  const dir = await mkdtemp(join(tmpdir(), 'pilot-steal-race-'));
  const lockDir = join(dir, 'inventory.json.lock');
  // Crashed holder both contenders judge stale.
  await mkdir(lockDir);
  await write(
    join(lockDir, 'owner.json'),
    JSON.stringify({
      pid: 999_999_999,
      startedAt: new Date(Date.now() - 300_000).toISOString(),
      token: 'dead-holder',
    })
  );
  // Between our stale verdict and our rename, the rival steals the dead
  // lock and publishes a live replacement. Our rename then moves the
  // rival's live directory instead of the stale one inspected.
  let fired = false;
  let rivalSawLiveReplacement = false;
  const acquire = acquireInventoryLock(lockDir, {
    beforeStaleRename: async () => {
      if (fired) {
        return;
      }
      fired = true;
      await rename(lockDir, `${lockDir}.rival-claimed`);
      await rm(`${lockDir}.rival-claimed`, { force: true, recursive: true });
      await mkdir(lockDir);
      await write(
        join(lockDir, 'owner.json'),
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
          token: 'rival-live',
        })
      );
      // The rival holds briefly, then verifies its replacement survived
      // our steal before releasing.
      setTimeout(async () => {
        const live = await readFile(join(lockDir, 'owner.json'), 'utf8').catch(
          () => null
        );
        rivalSawLiveReplacement =
          live !== null && JSON.parse(live).token === 'rival-live';
        await releaseInventoryLock(lockDir, 'rival-live');
      }, 100);
    },
  });
  const token = await acquire;
  assert.equal(rivalSawLiveReplacement, true);
  assert.notEqual(token, 'rival-live');
  await releaseInventoryLock(lockDir, token);
  // Neither the restored replacement nor steal debris remains.
  assert.deepEqual(await readdir(dir), []);
});

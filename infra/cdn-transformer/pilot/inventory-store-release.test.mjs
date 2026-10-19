import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

function ownerRecord(token) {
  return JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token,
  });
}

test('releaseInventoryLock never deletes a successor lock published in the release window', async () => {
  const { acquireInventoryLock, releaseInventoryLock } = await import(
    './inventory-store.mjs'
  );
  const dir = await mkdtemp(join(tmpdir(), 'pilot-release-race-'));
  const lockDir = join(dir, 'inventory.json.lock');
  const token = await acquireInventoryLock(lockDir);
  // A delayed stale-lock stealer wins between the release's move-aside
  // and its deletion: the victim's directory is gone from the live path
  // and a successor publishes there. Deleting by pathname would take the
  // successor with it; the atomic release deletes only the moved-aside
  // directory it verified as its own.
  let fired = false;
  await releaseInventoryLock(lockDir, token, {
    afterReleaseRename: async () => {
      fired = true;
      await mkdir(lockDir);
      await writeFile(join(lockDir, 'owner.json'), ownerRecord('successor'));
    },
  });
  assert.equal(fired, true);
  const live = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8'));
  assert.equal(live.token, 'successor');
  assert.deepEqual(await readdir(dir), ['inventory.json.lock']);
  await releaseInventoryLock(lockDir, 'successor');
  assert.deepEqual(await readdir(dir), []);
});

test('releaseInventoryLock restores a foreign lock it moved aside', async () => {
  const { releaseInventoryLock } = await import('./inventory-store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-release-foreign-'));
  const lockDir = join(dir, 'inventory.json.lock');
  await mkdir(lockDir);
  await writeFile(join(lockDir, 'owner.json'), ownerRecord('owner-b'));
  // The victim's token no longer matches the live lock: the atomic
  // release moves it aside, sees foreign ownership, and restores it
  // instead of deleting.
  await releaseInventoryLock(lockDir, 'superseded-a');
  assert.deepEqual(await readdir(lockDir), ['owner.json']);
  const live = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8'));
  assert.equal(live.token, 'owner-b');
  assert.deepEqual(await readdir(dir), ['inventory.json.lock']);
});

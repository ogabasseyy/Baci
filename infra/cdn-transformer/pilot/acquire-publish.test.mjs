import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireSnapshot } from './acquire.mjs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  makeInputRoot,
  MERCHANT,
  PNG_BYTES,
  stubProbe,
  withServer,
} from './acquire-fixtures.mjs';

test('rejects content-type and decoded-format mismatches', async () => {
  const inputRoot = await makeInputRoot();
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_BYTES);
    },
    async (url) => {
      const jpegProbe = async () => ({ format: 'jpeg', height: 1, width: 1 });
      await assert.rejects(
        () =>
          acquireSnapshot({
            allowPrivateHosts: true,
            assetId: 'logo-1',
            inputRoot,
            merchantId: MERCHANT,
            probe: jpegProbe,
            role: 'logo',
            slot: 'header-logo',
            url,
          }),
        /labeled bytes "image\/png" but they decode as "jpeg"/
      );
      // The mismatched snapshot is removed, like other probe failures.
      await assert.rejects(
        readFile(join(inputRoot, `${MERCHANT}-logo-1.png`)),
        /ENOENT/
      );
    }
  );
});

test('publish fails loudly when the snapshot vanished before the append', async () => {
  const inputRoot = await makeInputRoot();
  const inventoryPath = join(inputRoot, 'inventory.json');
  await writeFile(inventoryPath, JSON.stringify([]));
  // The probe deletes the snapshot this call just wrote, simulating a
  // rival rollback that won the inventory lock first: the append must
  // revalidate under the same lock and fail instead of publishing a
  // record that points at a missing source.
  const racingProbe = async (target) => {
    await rm(target, { force: true });
    return { format: 'png', height: 1, width: 1 };
  };
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_BYTES);
    },
    async (url) => {
      await assert.rejects(
        () =>
          acquireSnapshot({
            allowPrivateHosts: true,
            assetId: 'logo-1',
            inputRoot,
            inventoryPath,
            merchantId: MERCHANT,
            probe: racingProbe,
            role: 'logo',
            slot: 'header-logo',
            url,
          }),
        /vanished before publish/
      );
    }
  );
  assert.equal(JSON.parse(await readFile(inventoryPath, 'utf8')).length, 0);
});

test('a rejected inventory append rolls back only its own snapshot', async () => {
  const inputRoot = await makeInputRoot();
  const inventoryPath = join(inputRoot, 'inventory.json');
  // Occupied merchant/slot: both appends below must reject as duplicates.
  await writeFile(
    inventoryPath,
    JSON.stringify([
      {
        assetId: 'logo-0',
        merchantId: MERCHANT,
        role: 'logo',
        schemaVersion: 1,
        sha256: 'a'.repeat(64),
        slot: 'header-logo',
        sourcePath: `${MERCHANT}-logo-0.png`,
      },
    ])
  );
  const attempt = (assetId) =>
    withServer(
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(PNG_BYTES);
      },
      (url) =>
        acquireSnapshot({
          allowPrivateHosts: true,
          assetId,
          inputRoot,
          inventoryPath,
          merchantId: MERCHANT,
          probe: stubProbe,
          role: 'logo',
          slot: 'header-logo',
          url,
        })
    );
  // Fresh write: the orphan is removed and the inventory keeps one record.
  await assert.rejects(() => attempt('logo-1'), /duplicate slot/);
  await assert.rejects(
    readFile(join(inputRoot, `${MERCHANT}-logo-1.png`)),
    /ENOENT/
  );
  assert.equal(JSON.parse(await readFile(inventoryPath, 'utf8')).length, 1);
  // Pre-existing identical bytes: not this call's file, so it is kept.
  await writeFile(join(inputRoot, `${MERCHANT}-logo-2.png`), PNG_BYTES);
  await assert.rejects(() => attempt('logo-2'), /duplicate slot/);
  assert.deepEqual(
    await readFile(join(inputRoot, `${MERCHANT}-logo-2.png`)),
    PNG_BYTES
  );
});

test('a losing append never deletes a published snapshot', async () => {
  // Overlap shape: this call wrote the snapshot file but lost the
  // inventory-append race — the winner's record references these exact
  // bytes. Rollback must keep the file, not orphan the record.
  const inputRoot = await makeInputRoot();
  const inventoryPath = join(inputRoot, 'inventory.json');
  const target = join(inputRoot, `${MERCHANT}-racer.png`);
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_BYTES);
    },
    async (url) => {
      await acquireSnapshot({
        allowPrivateHosts: true,
        assetId: 'racer',
        inputRoot,
        inventoryPath,
        merchantId: MERCHANT,
        probe: stubProbe,
        role: 'logo',
        slot: 'header-logo',
        url,
      });
    }
  );
  // The winner's record is published; the snapshot file is gone from
  // disk (the loser's position: it must rewrite, then fail to append).
  await rm(target);
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_BYTES);
    },
    async (url) => {
      await assert.rejects(
        () =>
          acquireSnapshot({
            allowPrivateHosts: true,
            assetId: 'racer',
            inputRoot,
            inventoryPath,
            merchantId: MERCHANT,
            probe: stubProbe,
            role: 'logo',
            slot: 'header-logo',
            url,
          }),
        /duplicate/
      );
    }
  );
  // The loser's rewrite restored the winner's bytes — and rollback kept
  // them, so the published record still resolves.
  assert.deepEqual(await readFile(target), PNG_BYTES);
});

test('a fresh snapshot is fsync-durable before the call returns', async () => {
  const { open } = await import('node:fs/promises');
  const inputRoot = await makeInputRoot();
  // Crash-durability is only observable across a crash, so the regression
  // pins the mechanism instead: the snapshot write path must issue a real
  // fsync on the same descriptor it wrote, before returning. The spy
  // counts FileHandle.sync calls process-wide; this file's tests run
  // sequentially and the record-only path below performs no other sync.
  const scratch = await open(join(inputRoot, 'probe.tmp'), 'w');
  const fileHandleProto = Object.getPrototypeOf(scratch);
  await scratch.close();
  const realSync = fileHandleProto.sync;
  let syncs = 0;
  fileHandleProto.sync = async function (...args) {
    syncs += 1;
    return realSync.apply(this, args);
  };
  try {
    await withServer(
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(PNG_BYTES);
      },
      async (url) => {
        await acquireSnapshot({
          allowPrivateHosts: true,
          assetId: 'logo-1',
          inputRoot,
          merchantId: MERCHANT,
          probe: stubProbe,
          role: 'logo',
          slot: 'header-logo',
          url,
        });
      }
    );
  } finally {
    fileHandleProto.sync = realSync;
  }
  assert.ok(syncs >= 1, `expected at least one fsync, saw ${syncs}`);
});

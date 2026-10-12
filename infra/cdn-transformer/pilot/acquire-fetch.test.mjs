import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireSnapshot } from './acquire.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  fixture,
  makeInputRoot,
  MERCHANT,
  PNG_BYTES,
  sha256,
  stubProbe,
  withServer,
} from './acquire-fixtures.mjs';

test('acquires a public image into a hashed snapshot record', async () => {
  const inputRoot = await makeInputRoot();
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_BYTES);
    },
    async (url) => {
      const record = await acquireSnapshot({
        allowPrivateHosts: true,
        assetId: 'logo-1',
        inputRoot,
        merchantId: MERCHANT,
        probe: stubProbe,
        role: 'logo',
        slot: 'header-logo',
        url,
      });
      assert.equal(record.sha256, sha256(PNG_BYTES));
      assert.equal(record.size, PNG_BYTES.length);
      assert.equal(record.contentType, 'image/png');
      assert.equal(record.width, 1);
      assert.equal(record.height, 1);
      assert.equal(record.sourcePath, `${MERCHANT}-logo-1.png`);
      const stored = await readFile(join(inputRoot, `${MERCHANT}-logo-1.png`));
      assert.deepEqual(stored, PNG_BYTES);
    }
  );
});

test('records EXIF-oriented acquisition dims from the probe', async () => {
  const inputRoot = await makeInputRoot();
  const orientedProbe = async () => ({
    format: 'png',
    height: 5,
    orientedHeight: 3,
    orientedWidth: 5,
    orientation: 6,
    width: 3,
  });
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_BYTES);
    },
    async (url) => {
      const record = await acquireSnapshot({
        allowPrivateHosts: true,
        assetId: 'photo-1',
        inputRoot,
        merchantId: MERCHANT,
        probe: orientedProbe,
        role: 'product',
        slot: 'pdp-hero',
        url,
      });
      assert.equal(record.width, 5);
      assert.equal(record.height, 3);
      assert.equal(record.orientation, 6);
    }
  );
});

test('swaps raw probe axes when the probe omits oriented dims', async () => {
  const inputRoot = await makeInputRoot();
  const rawProbe = async () => ({
    format: 'png',
    height: 5,
    orientation: 8,
    width: 3,
  });
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_BYTES);
    },
    async (url) => {
      const record = await acquireSnapshot({
        allowPrivateHosts: true,
        assetId: 'photo-2',
        inputRoot,
        merchantId: MERCHANT,
        probe: rawProbe,
        role: 'product',
        slot: 'pdp-hero',
        url,
      });
      assert.equal(record.width, 5);
      assert.equal(record.height, 3);
      assert.equal(record.orientation, 8);
    }
  );
});

test('refuses header-valid but truncated snapshots with the decoding probe', async () => {
  const inputRoot = await makeInputRoot();
  const full = await readFile(fixture('tiny-48x48.png'));
  const truncated = full.subarray(0, 60);
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(truncated);
    },
    async (url) => {
      // No stub probe: the default worker probe must fully decode.
      await assert.rejects(
        () =>
          acquireSnapshot({
            allowPrivateHosts: true,
            assetId: 'truncated-1',
            inputRoot,
            merchantId: MERCHANT,
            role: 'logo',
            slot: 'header-logo',
            url,
          }),
        /does not fully decode/
      );
      // The rejected probe leaves no orphan snapshot behind.
      await assert.rejects(
        () => readFile(join(inputRoot, `${MERCHANT}-truncated-1.png`)),
        /ENOENT/
      );
    }
  );
});

test('refuses loopback fetches by default without touching the network', async () => {
  const inputRoot = await makeInputRoot();
  let fetches = 0;
  await withServer(
    (_request, response) => {
      fetches += 1;
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_BYTES);
    },
    async (url) => {
      await assert.rejects(
        () =>
          acquireSnapshot({
            assetId: 'logo-1',
            inputRoot,
            merchantId: MERCHANT,
            probe: stubProbe,
            role: 'logo',
            slot: 'header-logo',
            url,
          }),
        /refusing non-public fetch destination/
      );
      assert.equal(fetches, 0);
    }
  );
});

test('refuses metadata and localhost URLs by default', async () => {
  const inputRoot = await makeInputRoot();
  for (const url of [
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:8080/a.png',
    'http://[::1]/a.png',
  ]) {
    await assert.rejects(
      () =>
        acquireSnapshot({
          assetId: 'logo-1',
          inputRoot,
          merchantId: MERCHANT,
          probe: stubProbe,
          role: 'logo',
          slot: 'header-logo',
          url,
        }),
      /refusing (non-public|loopback) fetch destination/
    );
  }
});

test('isolates identical asset ids across merchants', async () => {
  const inputRoot = await makeInputRoot();
  const otherMerchant = 'de968340-de02-4aa8-95f9-9d5f7d2b1f20';
  const otherBytes = Buffer.concat([PNG_BYTES, Buffer.from('second-tenant')]);
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_BYTES);
    },
    async (url) => {
      const first = await acquireSnapshot({
        allowPrivateHosts: true,
        assetId: 'logo-1',
        inputRoot,
        merchantId: MERCHANT,
        probe: stubProbe,
        role: 'logo',
        slot: 'header-logo',
        url,
      });
      assert.equal(first.sourcePath, `${MERCHANT}-logo-1.png`);
    }
  );
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(otherBytes);
    },
    async (url) => {
      // Same asset id, different merchant and bytes: must not collide with
      // (or falsely accuse) the first tenant's snapshot.
      const second = await acquireSnapshot({
        allowPrivateHosts: true,
        assetId: 'logo-1',
        inputRoot,
        merchantId: otherMerchant,
        probe: stubProbe,
        role: 'logo',
        slot: 'header-logo',
        url,
      });
      assert.equal(second.sourcePath, `${otherMerchant}-logo-1.png`);
      assert.equal(second.sha256, sha256(otherBytes));
      const stored = await readFile(
        join(inputRoot, `${otherMerchant}-logo-1.png`)
      );
      assert.deepEqual(stored, otherBytes);
    }
  );
});

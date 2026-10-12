import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireSnapshot } from './acquire.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  makeInputRoot,
  MERCHANT,
  PNG_BYTES,
  stubProbe,
  withServer,
} from './acquire-fixtures.mjs';

test('rejects an oversized stored snapshot without loading it', async () => {
  const inputRoot = await makeInputRoot();
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_BYTES);
    },
    async (url) => {
      await acquireSnapshot({
        allowPrivateHosts: true,
        assetId: 'swollen',
        inputRoot,
        merchantId: MERCHANT,
        probe: stubProbe,
        role: 'logo',
        slot: 'header-logo',
        url,
      });
      // Corrupt or swapped-in giant stale file: the re-acquire must
      // reject on size before the equality comparison.
      await writeFile(
        join(inputRoot, `${MERCHANT}-swollen.png`),
        Buffer.alloc(2048, 7)
      );
      await assert.rejects(
        () =>
          acquireSnapshot({
            allowPrivateHosts: true,
            assetId: 'swollen',
            inputRoot,
            maxBytes: 1024,
            merchantId: MERCHANT,
            probe: stubProbe,
            role: 'logo',
            slot: 'header-logo',
            url,
          }),
        /stored snapshot.*exceeds 1024/
      );
    }
  );
});

test('removes a newly written snapshot when the probe rejects it', async () => {
  const inputRoot = await makeInputRoot();
  const failingProbe = () => Promise.reject(new Error('probe boom'));
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
            merchantId: MERCHANT,
            probe: failingProbe,
            role: 'logo',
            slot: 'header-logo',
            url,
          }),
        /probe boom/
      );
      await assert.rejects(
        readFile(join(inputRoot, `${MERCHANT}-logo-1.png`)),
        /ENOENT/
      );
    }
  );
});

test('keeps a pre-existing snapshot when the probe rejects it', async () => {
  const inputRoot = await makeInputRoot();
  const target = join(inputRoot, `${MERCHANT}-logo-1.png`);
  await writeFile(target, PNG_BYTES);
  const failingProbe = () => Promise.reject(new Error('probe boom'));
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
            merchantId: MERCHANT,
            probe: failingProbe,
            role: 'logo',
            slot: 'header-logo',
            url,
          }),
        /probe boom/
      );
      const kept = await readFile(target);
      assert.deepEqual(kept, PNG_BYTES);
    }
  );
});

test('rejects a null response body as an acquire error', async () => {
  const inputRoot = await makeInputRoot();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    body: null,
    headers: { get: () => 'image/png' },
    ok: true,
  });
  try {
    await assert.rejects(
      () =>
        acquireSnapshot({
          allowPrivateHosts: true,
          assetId: 'logo-1',
          inputRoot,
          merchantId: MERCHANT,
          probe: stubProbe,
          role: 'logo',
          slot: 'header-logo',
          url: 'https://cdn.example.com/media/logo-1.png',
        }),
      /empty body/
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('rejects unsafe or over-long asset ids before fetching', async () => {
  const inputRoot = await makeInputRoot();
  let fetches = 0;
  await withServer(
    (_request, response) => {
      fetches += 1;
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_BYTES);
    },
    async (url) => {
      const base = {
        allowPrivateHosts: true,
        inputRoot,
        merchantId: MERCHANT,
        probe: stubProbe,
        role: 'logo',
        slot: 'header-logo',
        url,
      };
      // Unsafe characters never reach the snapshot namer (or the network).
      await assert.rejects(
        () => acquireSnapshot({ ...base, assetId: '../evil' }),
        /invalid identity/
      );
      // 92-char id: contract-valid length, but the 36+1+92 stem exceeds 128.
      await assert.rejects(
        () => acquireSnapshot({ ...base, assetId: 'a'.repeat(92) }),
        /128 characters/
      );
      // 91 chars is the longest stem-safe id.
      const record = await acquireSnapshot({
        allowPrivateHosts: true,
        ...base,
        assetId: 'a'.repeat(91),
      });
      assert.equal(record.assetId, 'a'.repeat(91));
      assert.equal(fetches, 1);
    }
  );
});


import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireSnapshot } from './acquire.mjs';

import {
  makeInputRoot,
  MERCHANT,
  PNG_BYTES,
  stubProbe,
  withServer,
} from './acquire-fixtures.mjs';

test('rejects non-http URLs and unsupported content types', async () => {
  const inputRoot = await makeInputRoot();
  await assert.rejects(
    () =>
      acquireSnapshot({
        allowPrivateHosts: true,
        assetId: 'x',
        inputRoot,
        merchantId: MERCHANT,
        probe: stubProbe,
        role: 'logo',
        slot: 's',
        url: 'file:///etc/passwd',
      }),
    /https?/
  );
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end('<svg></svg>');
    },
    async (url) => {
      await assert.rejects(
        () =>
          acquireSnapshot({
            allowPrivateHosts: true,
            assetId: 'x',
            inputRoot,
            merchantId: MERCHANT,
            probe: stubProbe,
            role: 'logo',
            slot: 's',
            url,
          }),
        /content-type/i
      );
    }
  );
});

test('rejects bad identity fields before fetching', async () => {
  const inputRoot = await makeInputRoot();
  await assert.rejects(
    () =>
      acquireSnapshot({
        allowPrivateHosts: true,
        assetId: 'x',
        inputRoot,
        merchantId: 'not-a-uuid',
        probe: stubProbe,
        role: 'logo',
        slot: 's',
        url: 'http://127.0.0.1:1/a.png',
      }),
    /merchantId/
  );
  await assert.rejects(
    () =>
      acquireSnapshot({
        allowPrivateHosts: true,
        assetId: 'x',
        inputRoot,
        merchantId: MERCHANT,
        probe: stubProbe,
        role: 'banner',
        slot: 's',
        url: 'http://127.0.0.1:1/a.png',
      }),
    /role/
  );
});

test('aborts oversized bodies', async () => {
  const inputRoot = await makeInputRoot();
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(Buffer.alloc(4096, 9));
    },
    async (url) => {
      await assert.rejects(
        () =>
          acquireSnapshot({
            allowPrivateHosts: true,
            assetId: 'big',
            inputRoot,
            maxBytes: 1024,
            merchantId: MERCHANT,
            probe: stubProbe,
            role: 'product',
            slot: 'card',
            url,
          }),
        /exceeds/
      );
    }
  );
});

test('times out a hanging origin', async () => {
  const inputRoot = await makeInputRoot();
  await withServer(
    () => {
      // Never respond; the client timeout must fire.
    },
    async (url) => {
      await assert.rejects(
        () =>
          acquireSnapshot({
            allowPrivateHosts: true,
            assetId: 'hang',
            inputRoot,
            merchantId: MERCHANT,
            probe: stubProbe,
            role: 'product',
            slot: 'card',
            timeoutMs: 100,
            url,
          }),
        /timed out|timeout|abort/i
      );
    }
  );
});

test('re-acquisition is idempotent for identical bytes only', async () => {
  const inputRoot = await makeInputRoot();
  let served = PNG_BYTES;
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(served);
    },
    async (url) => {
      const first = await acquireSnapshot({
        allowPrivateHosts: true,
        assetId: 'stable',
        inputRoot,
        merchantId: MERCHANT,
        probe: stubProbe,
        role: 'logo',
        slot: 'header-logo',
        url,
      });
      const second = await acquireSnapshot({
        allowPrivateHosts: true,
        assetId: 'stable',
        inputRoot,
        merchantId: MERCHANT,
        probe: stubProbe,
        role: 'logo',
        slot: 'header-logo',
        url,
      });
      assert.equal(second.sha256, first.sha256);
      served = Buffer.from('different-bytes');
      await assert.rejects(
        () =>
          acquireSnapshot({
            allowPrivateHosts: true,
            assetId: 'stable',
            inputRoot,
            merchantId: MERCHANT,
            probe: stubProbe,
            role: 'logo',
            slot: 'header-logo',
            url,
          }),
        /differs/
      );
    }
  );
});


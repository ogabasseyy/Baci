import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireSnapshot } from './acquire.mjs';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    return await run(`http://127.0.0.1:${port}/asset.png`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

const stubProbe = async () => ({ format: 'png', height: 1, width: 1 });

async function makeInputRoot() {
  return mkdtemp(join(tmpdir(), 'pilot-acquire-'));
}

test('acquires a public image into a hashed snapshot record', async () => {
  const inputRoot = await makeInputRoot();
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_BYTES);
    },
    async (url) => {
      const record = await acquireSnapshot({
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
      const stored = await readFile(join(inputRoot, `${otherMerchant}-logo-1.png`));
      assert.deepEqual(stored, otherBytes);
    }
  );
});

test('rejects non-http URLs and unsupported content types', async () => {
  const inputRoot = await makeInputRoot();
  await assert.rejects(
    () =>
      acquireSnapshot({
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
        assetId: 'stable',
        inputRoot,
        merchantId: MERCHANT,
        probe: stubProbe,
        role: 'logo',
        slot: 'header-logo',
        url,
      });
      const second = await acquireSnapshot({
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

test('appendInventoryRecord rejects route-rejected duplicates', async () => {
  const { appendInventoryRecord } = await import('./acquire.mjs');
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

test('removes a newly written snapshot when the probe rejects it', async () => {
  const inputRoot = await makeInputRoot();
  const failingProbe = async () => {
    throw new Error('probe boom');
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
  const failingProbe = async () => {
    throw new Error('probe boom');
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
        ...base,
        assetId: 'a'.repeat(91),
      });
      assert.equal(record.assetId, 'a'.repeat(91));
      assert.equal(fetches, 1);
    }
  );
});

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

test('serializes concurrent inventory appends without loss', async () => {
  const { appendInventoryRecord } = await import('./acquire.mjs');
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

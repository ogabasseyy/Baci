import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { acquireSnapshot } from './acquire.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', name);

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


import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPurgePayload,
  chunkPurgeUrls,
  discoverZoneId,
  fetchCloudflareJson,
  parsePurgeUrls,
  purgeCloudflareCache,
} from './cloudflare-purge-cache.mjs';

test('preserves Cloudflare status and Retry-After metadata on failures', async () => {
  await assert.rejects(
    () =>
      fetchCloudflareJson('/zones/zone-123/purge_cache', {
        fetchImpl: async () =>
          new Response(JSON.stringify({ errors: [], success: false }), {
            headers: { 'content-type': 'application/json', 'retry-after': '2' },
            status: 429,
          }),
        token: 'token',
      }),
    (error) => {
      assert.equal(error.status, 429);
      assert.ok(error.retryAfterMs >= 1_900 && error.retryAfterMs <= 2_000);
      return true;
    }
  );
});

test('parses comma and newline separated purge URLs', () => {
  assert.deepEqual(
    parsePurgeUrls(' https://ogabassey.com/blog,\nhttps://ogabassey.com/blog/sitemap.xml\n'),
    ['https://ogabassey.com/blog', 'https://ogabassey.com/blog/sitemap.xml']
  );
});

test('builds a files purge payload without duplicates', () => {
  assert.deepEqual(
    buildPurgePayload([
      'https://ogabassey.com/blog',
      'https://ogabassey.com/blog',
      'https://ogabassey.com/blog/sitemap.xml',
    ]),
    {
      files: ['https://ogabassey.com/blog', 'https://ogabassey.com/blog/sitemap.xml'],
    }
  );
});

test('chunks purge URLs at the Cloudflare single-file portable limit', () => {
  const urls = Array.from({ length: 205 }, (_, index) => `https://ogabassey.com/blog/${index}`);

  const chunks = chunkPurgeUrls(urls);

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 100);
  assert.equal(chunks[1].length, 100);
  assert.equal(chunks[2].length, 5);
});

test('discovers zone id by zone name using Cloudflare API', async () => {
  const calls = [];
  const fetchJson = async (path, options) => {
    calls.push({ path, options });
    return {
      result: [{ id: 'zone-123', name: 'ogabassey.com' }],
      success: true,
    };
  };

  await assert.doesNotReject(async () => {
    const zoneId = await discoverZoneId({ fetchJson, token: 'token', zoneName: 'ogabassey.com' });
    assert.equal(zoneId, 'zone-123');
  });
  assert.equal(calls[0].path, '/zones?name=ogabassey.com');
});

test('skips purge when token or URLs are missing', async () => {
  const warnings = [];
  const logger = {
    log: () => {},
    warn: (message) => warnings.push(message),
  };

  assert.deepEqual(
    await purgeCloudflareCache({
      logger,
      token: '',
      zoneName: 'ogabassey.com',
      urls: ['https://ogabassey.com/blog'],
    }),
    { skipped: true, reason: 'missing-token' }
  );
  assert.match(warnings[0], /CLOUDFLARE_API_TOKEN/);

  assert.deepEqual(
    await purgeCloudflareCache({
      logger,
      token: 'token',
      zoneName: 'ogabassey.com',
      urls: [],
    }),
    { skipped: true, reason: 'missing-urls' }
  );
  assert.match(warnings[1], /no purge URLs/);
});

test('surfaces zone discovery failures before purge', async () => {
  await assert.rejects(
    () =>
      purgeCloudflareCache({
        fetchJson: async () => ({ result: [], success: true }),
        token: 'token',
        urls: ['https://ogabassey.com/blog'],
        zoneName: 'ogabassey.com',
      }),
    /Cloudflare zone not found for ogabassey.com/
  );
});

test('surfaces Cloudflare API failures from the purge request', async () => {
  await assert.rejects(
    () =>
      purgeCloudflareCache({
        fetchJson: async (path) => {
          if (path.startsWith('/zones?')) {
            return { result: [{ id: 'zone-123' }], success: true };
          }
          throw new Error(
            'Cloudflare API request failed for /zones/zone-123/purge_cache: HTTP 401 10000:Authentication error'
          );
        },
        token: 'token',
        urls: ['https://ogabassey.com/blog'],
        zoneName: 'ogabassey.com',
      }),
    /HTTP 401 10000:Authentication error/
  );
});

test('purges files after zone discovery', async () => {
  const calls = [];
  const logger = { log: () => {}, warn: () => {} };
  const fetchJson = async (path, options) => {
    calls.push({ path, options });
    if (path.startsWith('/zones?')) {
      return { result: [{ id: 'zone-123' }], success: true };
    }
    return { result: { id: 'purge-123' }, success: true };
  };

  const result = await purgeCloudflareCache({
    fetchJson,
    logger,
    token: 'token',
    urls: ['https://ogabassey.com/blog'],
    zoneName: 'ogabassey.com',
  });

  assert.equal(result.skipped, false);
  assert.equal(calls[1].path, '/zones/zone-123/purge_cache');
  assert.deepEqual(calls[1].options.body, { files: ['https://ogabassey.com/blog'] });
});

test('sends multiple purge requests when URL list exceeds one Cloudflare batch', async () => {
  const calls = [];
  const logger = { log: () => {}, warn: () => {} };
  const fetchJson = async (path, options) => {
    calls.push({ path, options });
    if (path.startsWith('/zones?')) {
      return { result: [{ id: 'zone-123' }], success: true };
    }
    return { result: { id: 'purge-123' }, success: true };
  };
  const urls = Array.from({ length: 101 }, (_, index) => `https://ogabassey.com/blog/${index}`);

  await purgeCloudflareCache({
    fetchJson,
    logger,
    token: 'token',
    urls,
    zoneName: 'ogabassey.com',
  });

  const purgeCalls = calls.filter((call) => call.path.endsWith('/purge_cache'));
  assert.equal(purgeCalls.length, 2);
  assert.equal(purgeCalls[0].options.body.files.length, 100);
  assert.equal(purgeCalls[1].options.body.files.length, 1);
});

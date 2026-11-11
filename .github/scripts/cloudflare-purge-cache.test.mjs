import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHostPurgePayload,
  buildPurgePayload,
  chunkPurgeUrls,
  discoverZoneId,
  fetchCloudflareJson,
  parsePurgeUrls,
  purgeCloudflareCache,
  purgeCloudflareHosts,
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

test('builds a hosts-only purge payload without duplicates', () => {
  assert.deepEqual(
    buildHostPurgePayload(['ogabassey.com', 'www.ogabassey.com', 'ogabassey.com']),
    { hosts: ['ogabassey.com', 'www.ogabassey.com'] }
  );
});

test('purges hostnames after zone discovery and never sends files or purge_everything', async () => {
  const calls = [];
  const logger = { log: () => {}, warn: () => {} };
  const fetchJson = async (path, options) => {
    calls.push({ path, options });
    if (path.startsWith('/zones?')) {
      return { result: [{ id: 'zone-123' }], success: true };
    }
    return { result: { id: 'purge-123' }, success: true };
  };

  const result = await purgeCloudflareHosts({
    fetchJson,
    hosts: ['ogabassey.com', 'www.ogabassey.com'],
    logger,
    token: 'token',
    zoneName: 'ogabassey.com',
  });

  assert.equal(result.skipped, false);
  assert.deepEqual(result.hosts, ['ogabassey.com', 'www.ogabassey.com']);
  assert.equal(calls[1].path, '/zones/zone-123/purge_cache');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(calls[1].options.body, { hosts: ['ogabassey.com', 'www.ogabassey.com'] });
  assert.equal('files' in calls[1].options.body, false);
  assert.equal('purge_everything' in calls[1].options.body, false);
});

test('skips the hostname purge when the token or hostnames are missing', async () => {
  const warnings = [];
  const logger = { log: () => {}, warn: (message) => warnings.push(message) };
  const fetchJson = async () => assert.fail('must not call Cloudflare');

  assert.deepEqual(
    await purgeCloudflareHosts({ fetchJson, hosts: ['ogabassey.com'], logger, zoneId: 'zone-123' }),
    { skipped: true, reason: 'missing-token' }
  );
  assert.deepEqual(
    await purgeCloudflareHosts({ fetchJson, hosts: [], logger, token: 'token', zoneId: 'zone-123' }),
    { skipped: true, reason: 'missing-hosts' }
  );
  assert.match(warnings[0], /CLOUDFLARE_API_TOKEN is not set/);
  assert.match(warnings[1], /no hostnames/);
});

test('the hostname purge primitive refuses cdn.* hosts and anything that is not a plain DNS hostname', async () => {
  for (const bad of [
    'cdn.ogabassey.com',
    'foo.cdn.ogabassey.com',
    'https://ogabassey.com',
    '*.ogabassey.com',
    'ogabassey.com/blog',
    '127.0.0.1',
    'localhost',
    '',
  ]) {
    assert.throws(() => buildHostPurgePayload([bad]), /DNS hostname|cdn\./, `rejects ${bad}`);
  }

  await assert.rejects(
    purgeCloudflareHosts({
      fetchJson: async () => assert.fail('must not call Cloudflare for a refused hostname'),
      hosts: ['ogabassey.com', 'cdn.ogabassey.com'],
      logger: { log: () => {}, warn: () => {} },
      token: 'token',
      zoneId: 'zone-123',
    }),
    /never target cdn\.\* hostnames/
  );
});

test('the cdn guard rejects any cdn label but not names that merely start with cdn', () => {
  assert.throws(() => buildHostPurgePayload(['assets.CDN.ogabassey.com']), /cdn\./);
  assert.deepEqual(buildHostPurgePayload(['cdn-store.example.com', 'shop.example.com']), {
    hosts: ['cdn-store.example.com', 'shop.example.com'],
  });
});

test('the hostname purge payload lowercases and deduplicates hostnames', () => {
  assert.deepEqual(buildHostPurgePayload(['OgaBassey.com', 'ogabassey.com', 'WWW.ogabassey.com']), {
    hosts: ['ogabassey.com', 'www.ogabassey.com'],
  });
});

test('logs and returns the normalized hostnames that are actually sent to Cloudflare', async () => {
  const messages = [];
  const sent = [];
  const result = await purgeCloudflareHosts({
    fetchJson: async (path, options) => {
      sent.push(options.body);
      return { result: { id: 'purge-123' }, success: true };
    },
    hosts: ['OgaBassey.com', 'ogabassey.com', 'WWW.ogabassey.com'],
    logger: { log: (message) => messages.push(message), warn: () => {} },
    token: 'token',
    zoneId: 'zone-123',
  });

  assert.deepEqual(sent, [{ hosts: ['ogabassey.com', 'www.ogabassey.com'] }]);
  assert.deepEqual(result.hosts, ['ogabassey.com', 'www.ogabassey.com']);
  assert.match(messages.join('\n'), /Purged 2 Cloudflare hostname\(s\) \(ogabassey\.com, www\.ogabassey\.com\)/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHostPurgePayload, purgeCloudflareHosts } from './cloudflare-purge-cache.mjs';

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

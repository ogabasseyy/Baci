import assert from 'node:assert/strict';
import test from 'node:test';
import {
  purgeReleaseHosts,
  releaseHostsFor,
} from './storefront-release-coherence-escalation.mjs';

const quietLogger = { log: () => {}, warn: () => {} };

test('derives the apex and www hostnames to purge from the release origin', () => {
  assert.deepEqual(releaseHostsFor('https://ogabassey.com'), ['ogabassey.com', 'www.ogabassey.com']);
  assert.deepEqual(releaseHostsFor('https://www.ogabassey.com'), [
    'ogabassey.com',
    'www.ogabassey.com',
  ]);
  assert.throws(() => releaseHostsFor('https://cdn.ogabassey.com'), /cdn\./);
  assert.throws(() => releaseHostsFor('https://127.0.0.1'), /DNS hostname/);
  assert.throws(() => releaseHostsFor('https://localhost'), /DNS hostname/);
});

test('hostname purge sends only a hosts payload and retries transient Cloudflare failures', async () => {
  const requests = [];
  const sleeps = [];
  let calls = 0;
  const result = await purgeReleaseHosts({
    cloudflareFetchJson: async (path, options) => {
      requests.push({ options, path });
      calls += 1;
      if (calls === 1) {
        const error = new Error('Cloudflare API request failed: HTTP 429');
        error.status = 429;
        error.retryAfterMs = 4000;
        throw error;
      }
      return { result: { id: 'zone-123' }, success: true };
    },
    hosts: ['ogabassey.com', 'www.ogabassey.com'],
    logger: quietLogger,
    retryDelayMs: 10,
    sleep: async (delayMs) => sleeps.push(delayMs),
    token: 'token',
    zoneId: 'zone-123',
  });

  assert.equal(result.skipped, false);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].path, '/zones/zone-123/purge_cache');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.token, 'token');
  assert.deepEqual(requests[0].options.body, { hosts: ['ogabassey.com', 'www.ogabassey.com'] });
  assert.equal('files' in requests[0].options.body, false);
  assert.equal('purge_everything' in requests[0].options.body, false);
  assert.deepEqual(sleeps, [4000]);
});

test('hostname purge does not retry permanent Cloudflare failures or a missing token', async () => {
  let calls = 0;
  await assert.rejects(
    purgeReleaseHosts({
      cloudflareFetchJson: async () => {
        calls += 1;
        const error = new Error('Cloudflare API request failed: HTTP 403');
        error.status = 403;
        throw error;
      },
      hosts: ['ogabassey.com'],
      logger: quietLogger,
      sleep: async () => assert.fail('must not wait before a permanent failure'),
      token: 'token',
      zoneId: 'zone-123',
    }),
    /HTTP 403/
  );
  assert.equal(calls, 1);

  await assert.rejects(
    purgeReleaseHosts({
      cloudflareFetchJson: async () => assert.fail('must not call Cloudflare without a token'),
      hosts: ['ogabassey.com'],
      logger: quietLogger,
      token: '',
      zoneId: 'zone-123',
    }),
    /hostname purge was skipped: missing-token/
  );
});

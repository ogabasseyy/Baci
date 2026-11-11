import assert from 'node:assert/strict';
import test from 'node:test';
import { RELEASE_USER_AGENTS } from './storefront-release-coherence.mjs';
import {
  MARKER,
  makeStorefront,
  productsOnly,
  response,
  run,
} from './storefront-release-coherence.test-helpers.mjs';

test('bugfix: falls back to a hostname purge when the page purge leaves /products on the previous release', async () => {
  const { fetchImpl, state } = makeStorefront({ isStale: productsOnly });
  const hostPurges = [];
  const pagePurges = [];

  const result = await run({
    fetchImpl,
    hostPurgeImpl: async (options) => {
      hostPurges.push(options);
      state.hostPurged = true;
      return { hosts: options.hosts, skipped: false };
    },
    releasePurgeImpl: async ({ canaryUrls }) => {
      pagePurges.push(canaryUrls);
      return { skipped: false, urls: canaryUrls };
    },
  });

  assert.equal(result.marker, MARKER);
  assert.equal(result.escalated, true);
  assert.equal(pagePurges.length, 1, 'the page-by-page purge still runs first');
  assert.equal(hostPurges.length, 1);
  assert.deepEqual(hostPurges[0].hosts, ['ogabassey.com', 'www.ogabassey.com']);
  assert.equal(hostPurges[0].token, 'token');
  assert.equal(hostPurges[0].zoneId, 'zone-123');
});

test('does not send a hostname purge when stale canaries converge inside the normal retry window', async () => {
  let staleResponses = 0;
  const { fetchImpl } = makeStorefront({
    isStale: (url, options) =>
      url.pathname === '/products' &&
      options.headers['user-agent'] === RELEASE_USER_AGENTS.browser &&
      staleResponses++ === 0,
  });
  let hostPurges = 0;

  const result = await run({
    fetchImpl,
    hostPurgeImpl: async () => {
      hostPurges += 1;
      return { skipped: false };
    },
  });

  assert.equal(result.escalated, false);
  assert.equal(hostPurges, 0);
});

test('does not send a hostname purge for failures a purge cannot fix', async () => {
  const { fetchImpl } = makeStorefront();
  const failingFetch = async (value, options) => {
    const url = new URL(value);
    if (!url.search && url.pathname === '/blog') return response('unavailable', { status: 503 });
    return fetchImpl(value, options);
  };
  let hostPurges = 0;

  await assert.rejects(
    run({
      fetchImpl: failingFetch,
      hostPurgeImpl: async () => {
        hostPurges += 1;
        return { skipped: false };
      },
    }),
    /browser https:\/\/ogabassey\.com\/blog: .* returned HTTP 503/
  );
  assert.equal(hostPurges, 0);
});

test('stays strict: still fails when the old release survives the hostname purge', async () => {
  const { fetchImpl, state } = makeStorefront({ isStale: productsOnly });
  const sleeps = [];
  let hostPurges = 0;

  await assert.rejects(
    run({
      fetchImpl,
      hostPurgeImpl: async () => {
        hostPurges += 1;
        return { skipped: false };
      },
      sleep: async (delayMs) => sleeps.push(delayMs),
    }),
    /failed after the Cloudflare hostname purge: browser https:\/\/ogabassey\.com\/products: expected release_123, received release_122/
  );

  assert.equal(hostPurges, 1, 'the fallback runs once, never in a loop');
  const browserProducts = state.calls.filter(
    ({ options, url }) =>
      !url.search &&
      url.pathname === '/products' &&
      options.headers['user-agent'] === RELEASE_USER_AGENTS.browser
  );
  assert.equal(browserProducts.length, 2 + 3, 'normal attempts plus bounded escalation attempts');
  assert.deepEqual(sleeps, [1, 7, 7]);
});

test('fails closed when the hostname purge itself is rejected by Cloudflare', async () => {
  const { fetchImpl } = makeStorefront({ isStale: productsOnly });

  await assert.rejects(
    run({
      fetchImpl,
      hostPurgeImpl: async () => {
        throw new Error('Cloudflare API request failed for /zones/zone-123/purge_cache: HTTP 403');
      },
    }),
    /Cloudflare API request failed for \/zones\/zone-123\/purge_cache: HTTP 403/
  );
});

test('adds Cloudflare cache diagnostics to stale canary errors', async () => {
  const { fetchImpl } = makeStorefront({
    isStale: productsOnly,
    staleHeaders: {
      age: '224',
      'cf-cache-status': 'HIT',
      'cf-ray': 'a58c4af01ae52103-MAN',
      'x-vercel-cache': 'HIT',
      'x-vercel-id': 'fra1::6srnh-1794387017498-0b7546e9c018',
    },
  });

  await assert.rejects(
    run({ fetchImpl, hostPurgeImpl: async () => ({ skipped: false }) }),
    /received release_122 \[cf-cache-status=HIT age=224s x-vercel-cache=HIT filled=08:50:17Z cf-ray=a58c4af01ae52103-MAN\]/
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isOriginProbe,
  makeStorefront,
  productsOnly,
  response,
  run,
} from './storefront-release-coherence.test-helpers.mjs';

const stalePaths = (...paths) => (url) => paths.includes(url.pathname);

test('bugfix: the origin probe uses the native fetch when no fetchImpl is injected (production CLI path)', async () => {
  // deploy.yml runs `node storefront-release-coherence.mjs`, i.e. runReleaseCoherence() with no options.
  // The origin probe used to call an undefined fetchImpl, so the fallback never fired in production.
  const { fetchImpl, state } = makeStorefront({ isStale: productsOnly });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const result = await run({
      hostPurgeImpl: async () => {
        state.hostPurged = true;
        return { skipped: false };
      },
    });
    assert.equal(result.escalated, true);
    assert.ok(state.calls.some(({ url }) => isOriginProbe(url)), 'the origin was probed');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('probes the origin for every stale canary page, not only the home page, before purging', async () => {
  const { fetchImpl, state } = makeStorefront({ isStale: stalePaths('/products', '/smartphones') });
  let hostPurges = 0;

  const result = await run({
    fetchImpl,
    hostPurgeImpl: async () => {
      hostPurges += 1;
      state.hostPurged = true;
      return { skipped: false };
    },
  });

  assert.equal(result.escalated, true);
  assert.equal(hostPurges, 1);
  assert.deepEqual(
    state.calls
      .filter(({ url }) => isOriginProbe(url))
      .map(({ url }) => url.pathname)
      .sort(),
    ['/products', '/smartphones']
  );
});

test('does not escalate when a stale canary is accompanied by a hard failure on another page', async () => {
  const { fetchImpl } = makeStorefront({ isStale: productsOnly });
  const withBlogOutage = async (value, options) => {
    const url = new URL(value);
    if (!url.search && url.pathname === '/blog') return response('unavailable', { status: 503 });
    return fetchImpl(value, options);
  };
  let hostPurges = 0;

  await assert.rejects(
    run({
      fetchImpl: withBlogOutage,
      hostPurgeImpl: async () => {
        hostPurges += 1;
        return { skipped: false };
      },
    }),
    /browser https:\/\/ogabassey\.com\/blog: .* returned HTTP 503/
  );
  assert.equal(hostPurges, 0, 'a partial outage must not evict stale-if-error copies');
});

test('never purges during a partial origin outage: the stale page itself fails at the origin', async () => {
  const { fetchImpl } = makeStorefront({
    isStale: productsOnly,
    originFails: (url) => isOriginProbe(url) && url.pathname === '/products',
  });
  let hostPurges = 0;

  await assert.rejects(
    run({
      fetchImpl,
      hostPurgeImpl: async () => {
        hostPurges += 1;
        return { skipped: false };
      },
    }),
    /origin probe failed for \/products \(cache-busted origin probe returned HTTP 503\), so no hostname purge was attempted/
  );
  assert.equal(hostPurges, 0);
});

test('skips the hostname purge when a stale page is not on the expected release at the origin either', async () => {
  const { fetchImpl } = makeStorefront({ isStale: productsOnly, originMarker: 'release_122' });
  let hostPurges = 0;

  await assert.rejects(
    run({
      fetchImpl,
      hostPurgeImpl: async () => {
        hostPurges += 1;
        return { skipped: false };
      },
    }),
    /origin itself serves release_122 on \/products, so a Cloudflare purge cannot fix this/
  );
  assert.equal(hostPurges, 0);
});

test('says plainly that the hostname purge clears all cached content for the hostnames', async () => {
  const { fetchImpl, state } = makeStorefront({ isStale: productsOnly });
  const warnings = [];

  await run({
    fetchImpl,
    hostPurgeImpl: async () => {
      state.hostPurged = true;
      return { skipped: false };
    },
    logger: { log: () => {}, warn: (message) => warnings.push(message) },
  });

  assert.match(
    warnings.join('\n'),
    /hostname purge for ogabassey\.com, www\.ogabassey\.com.*clears ALL cached content for those hostnames/s
  );
});

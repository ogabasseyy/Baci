import assert from 'node:assert/strict';
import test from 'node:test';
import { RELEASE_USER_AGENTS } from './storefront-release-coherence.mjs';
import { verifyWithHostPurgeFallback } from './storefront-release-coherence-escalation.mjs';
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

test('probes the origin for every stale canary page and variant, with that variant\'s own user agent', async () => {
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
  const variantOf = (userAgent) =>
    Object.entries(RELEASE_USER_AGENTS).find(([, value]) => value === userAgent)?.[0];
  assert.deepEqual(
    state.calls
      .filter(({ url }) => isOriginProbe(url))
      .map(({ options, url }) => `${variantOf(options.headers['user-agent'])} ${url.pathname}`)
      .sort(),
    ['browser /products', 'browser /smartphones', 'googlebot /products', 'googlebot /smartphones']
  );
});

test('probes the origin with Googlebot\'s user agent when only the Googlebot copy is stale', async () => {
  const { fetchImpl, state } = makeStorefront({
    isStale: (url, options) =>
      url.pathname === '/products' && options.headers['user-agent'] === RELEASE_USER_AGENTS.googlebot,
  });

  const result = await run({
    fetchImpl,
    hostPurgeImpl: async () => {
      state.hostPurged = true;
      return { skipped: false };
    },
  });

  assert.equal(result.escalated, true);
  const probes = state.calls.filter(({ url }) => isOriginProbe(url));
  assert.equal(probes.length, 1);
  assert.equal(probes[0].options.headers['user-agent'], RELEASE_USER_AGENTS.googlebot);
  assert.equal(probes[0].url.pathname, '/products');
});

test('never purges when the Googlebot origin render fails even though the browser origin render is healthy', async () => {
  const { fetchImpl } = makeStorefront({
    isStale: (url, options) =>
      url.pathname === '/products' && options.headers['user-agent'] === RELEASE_USER_AGENTS.googlebot,
    originFails: (url, options) =>
      isOriginProbe(url) && options.headers['user-agent'] === RELEASE_USER_AGENTS.googlebot,
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
    /origin probe failed for googlebot \/products \(cache-busted origin probe returned HTTP 503\), so no hostname purge was attempted/
  );
  assert.equal(hostPurges, 0, 'a healthy browser render must not authorise purging the bot\'s stale fallback');
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
    /origin probe failed for browser \/products \(cache-busted origin probe returned HTTP 503\), so no hostname purge was attempted/
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
    /origin itself serves release_122 on \/products \(browser\), so a Cloudflare purge cannot fix this/
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

test('fails closed when a stale failure arrives without stale targets (no origin proof possible)', async () => {
  // verifyWithHostPurgeFallback is exported and `verify` is injectable: a stale-flagged error with
  // no (or empty) staleTargets must never reach the hostname purge without the per-target origin gate.
  for (const staleTargets of [undefined, [], 'https://ogabassey.com/products']) {
    const failure = Object.assign(new Error('Storefront release coherence failed: stale'), {
      stale: true,
      ...(staleTargets === undefined ? {} : { staleTargets }),
    });
    let hostPurges = 0;
    let probes = 0;

    await assert.rejects(
      verifyWithHostPurgeFallback({
        baseUrl: 'https://ogabassey.com',
        config: { attempts: 1, escalationAttempts: 1, expectedMarker: 'release_123', retryDelayMs: 1 },
        hostPurgeImpl: async () => {
          hostPurges += 1;
          return { skipped: false };
        },
        logger: { log: () => {}, warn: () => {} },
        probeOrigin: async () => {
          probes += 1;
          return 'release_123';
        },
        verify: async () => {
          throw failure;
        },
      }),
      (error) => error === failure
    );
    assert.equal(hostPurges, 0, `no hostname purge for staleTargets=${JSON.stringify(staleTargets)}`);
    assert.equal(probes, 0);
  }
});

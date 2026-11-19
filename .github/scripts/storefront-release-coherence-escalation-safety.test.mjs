import assert from 'node:assert/strict';
import test from 'node:test';
import { RELEASE_USER_AGENTS, resolveReleaseUserAgent } from './storefront-release-coherence.mjs';
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

// verifyWithHostPurgeFallback is exported and `verify` is injectable, so these tests drive it
// with a stale-flagged failure whose staleTargets are chosen by the test.
function attemptFallback(failure, overrides = {}) {
  const counts = { hostPurges: 0, probes: 0, verifies: 0 };
  const outcome = verifyWithHostPurgeFallback({
    baseUrl: 'https://ogabassey.com',
    config: { attempts: 1, escalationAttempts: 1, expectedMarker: 'release_123', retryDelayMs: 1 },
    hostPurgeImpl: async () => {
      counts.hostPurges += 1;
      return { skipped: false };
    },
    logger: { log: () => {}, warn: () => {} },
    probeOrigin: async () => {
      counts.probes += 1;
      return 'release_123';
    },
    verify: async () => {
      counts.verifies += 1;
      throw failure;
    },
    ...overrides,
  });
  return { counts, outcome };
}

const staleFailure = (extra) =>
  Object.assign(new Error('Storefront release coherence failed: stale'), { stale: true, ...extra });

test('fails closed when a stale failure arrives without stale targets (no origin proof possible)', async () => {
  // A stale-flagged error with no (or empty) staleTargets must never reach the hostname purge
  // without the per-target origin gate.
  for (const staleTargets of [undefined, [], 'https://ogabassey.com/products']) {
    const failure = staleFailure(staleTargets === undefined ? {} : { staleTargets });
    const { counts, outcome } = attemptFallback(failure);

    await assert.rejects(outcome, (error) => error === failure);
    assert.equal(counts.hostPurges, 0, `no hostname purge for staleTargets=${JSON.stringify(staleTargets)}`);
    assert.equal(counts.probes, 0);
  }
});

test('fails closed on a malformed stale target, before any origin probe or purge', async () => {
  const valid = { url: 'https://ogabassey.com/products', variant: 'browser' };
  for (const bad of [
    null,
    'https://ogabassey.com/products',
    {},
    { url: 'https://ogabassey.com/products' },
    { variant: 'browser' },
    { url: 42, variant: 'browser' },
    { url: '/products', variant: 'browser' },
    { url: 'not a url', variant: 'browser' },
    { url: 'ftp://ogabassey.com/products', variant: 'browser' },
    { url: 'https://ogabassey.com/products', variant: 7 },
  ]) {
    const failure = staleFailure({ staleTargets: [valid, bad] });
    const { counts, outcome } = attemptFallback(failure);

    await assert.rejects(
      outcome,
      (error) => {
        assert.match(error.message, /invalid stale target \(.+\), so no hostname purge was attempted/);
        assert.match(error.message, /Storefront release coherence failed: stale/);
        assert.equal(error.cause, failure);
        return true;
      },
      `rejects ${JSON.stringify(bad)}`
    );
    // The valid target is not probed either: every target is checked before any probe starts.
    assert.equal(counts.probes, 0, `no probe for ${JSON.stringify(bad)}`);
    assert.equal(counts.hostPurges, 0, `no hostname purge for ${JSON.stringify(bad)}`);
  }
});

test('fails closed when the hostname purge is reported as skipped (never a successful purge)', async () => {
  // purgeReleaseHosts throws on a skipped purge, but hostPurgeImpl is injectable and may return the skip.
  const failure = staleFailure({
    staleTargets: [{ url: 'https://ogabassey.com/products', variant: 'browser' }],
  });
  let purges = 0;
  const { counts, outcome } = attemptFallback(failure, {
    hostPurgeImpl: async () => {
      purges += 1;
      return { reason: 'missing-token', skipped: true };
    },
  });

  await assert.rejects(outcome, (error) => {
    assert.match(
      error.message,
      /hostname purge was skipped \(missing-token\), so the older release HTML was not cleared/
    );
    assert.equal(error.cause, failure);
    return true;
  });
  assert.equal(purges, 1);
  assert.equal(counts.verifies, 1, 'no second verification after a skipped purge');
});

test('resolves only the known user-agent variants, never inherited object keys', () => {
  assert.equal(resolveReleaseUserAgent('browser'), RELEASE_USER_AGENTS.browser);
  assert.equal(resolveReleaseUserAgent('googlebot'), RELEASE_USER_AGENTS.googlebot);
  for (const unknown of ['bingbot', 'constructor', 'toString', '__proto__', '', undefined, 7]) {
    assert.throws(
      () => resolveReleaseUserAgent(unknown),
      /unknown user-agent variant/,
      `rejects ${String(unknown)}`
    );
  }
});

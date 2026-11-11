import assert from 'node:assert/strict';
import test from 'node:test';
import { RELEASE_USER_AGENTS, runReleaseCoherence } from './storefront-release-coherence.mjs';

const MARKER = 'release_123';
const OLD_MARKER = 'release_122';
const PDP_PATH = '/smartphones/pixel-9-pro';
const ENV = {
  BACI_NEXT_DEPLOYMENT_ID_SOURCE: MARKER,
  CLOUDFLARE_API_TOKEN: 'token',
  CLOUDFLARE_ZONE_ID: 'zone-123',
  STOREFRONT_RELEASE_ATTEMPTS: '2',
  STOREFRONT_RELEASE_BASE_URL: 'https://ogabassey.com',
  STOREFRONT_RELEASE_ESCALATION_ATTEMPTS: '3',
  STOREFRONT_RELEASE_ESCALATION_RETRY_DELAY_MS: '7',
  STOREFRONT_RELEASE_RETRY_DELAY_MS: '1',
  STOREFRONT_RELEASE_TIMEOUT_MS: '1000',
};
const quietLogger = { log: () => {}, warn: () => {} };

function html(marker, extra = '') {
  return `<html data-dpl-id="${marker}"><link href="/a.css?dpl=${marker}">${extra}</html>`;
}

function response(body, { headers = {}, status = 200 } = {}) {
  return {
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8', ...headers }),
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

// A storefront whose canonical (no query) responses can stay on the previous release
// until `state.hostPurged` flips, like Cloudflare keeping an old copy after a page purge.
function makeStorefront({
  isStale = () => false,
  originMarker = MARKER,
  originStatus = 200,
  staleHeaders = {},
} = {}) {
  const state = { calls: [], hostPurged: false };
  const fetchImpl = async (value, options) => {
    const url = new URL(value);
    state.calls.push({ options, url });
    const extra = url.pathname === '/products' ? `<a href="${PDP_PATH}">Phone</a>` : '';
    const canonical = !url.search;
    if (!canonical) {
      return originStatus === 200
        ? response(html(originMarker, extra))
        : response('unavailable', { status: originStatus });
    }
    if (!state.hostPurged && isStale(url, options, state)) {
      return response(html(OLD_MARKER, extra), { headers: staleHeaders });
    }
    return response(html(MARKER, extra));
  };
  return { fetchImpl, state };
}

const productsOnly = (url) => url.pathname === '/products';

function run(overrides) {
  return runReleaseCoherence({
    env: ENV,
    logger: quietLogger,
    releasePurgeImpl: async ({ canaryUrls }) => ({ skipped: false, urls: canaryUrls }),
    requestId: 'request-escalation',
    sleep: async () => {},
    ...overrides,
  });
}

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

test('skips the hostname purge when the origin itself does not serve the expected release', async () => {
  const { fetchImpl } = makeStorefront({ isStale: productsOnly, originMarker: OLD_MARKER });
  let hostPurges = 0;

  await assert.rejects(
    run({
      fetchImpl,
      hostPurgeImpl: async () => {
        hostPurges += 1;
        return { skipped: false };
      },
    }),
    /origin itself serves release_122.*cannot fix/
  );
  assert.equal(hostPurges, 0);
});

test('never purges when the origin probe fails, so stale-if-error copies are not deleted during an outage', async () => {
  const { fetchImpl, state } = makeStorefront({ isStale: productsOnly });
  // The initial release probes must succeed; only the later origin probe (request id suffix) fails.
  const flakyOrigin = async (value, options) => {
    const url = new URL(value);
    if (url.searchParams.get('__baci_release_probe')?.endsWith('-origin')) {
      return response('unavailable', { status: 503 });
    }
    return fetchImpl(value, options);
  };
  let hostPurges = 0;

  await assert.rejects(
    run({
      fetchImpl: flakyOrigin,
      hostPurgeImpl: async () => {
        hostPurges += 1;
        state.hostPurged = true;
        return { skipped: false };
      },
    }),
    /origin probe failed \(cache-busted origin probe returned HTTP 503\), so no hostname purge was attempted/
  );
  assert.equal(hostPurges, 0);
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

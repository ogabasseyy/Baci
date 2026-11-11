import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCanaryUrls,
  discoverPdpPath,
  extractDeploymentMarker,
  RELEASE_USER_AGENTS,
  runReleaseCoherence,
  warmAndAssertCanaries,
} from './storefront-release-coherence.mjs';
import { readReleaseConfig } from './storefront-release-config.mjs';

const MARKER = 'release_123';
const ENV = {
  CLOUDFLARE_API_TOKEN: 'token',
  CLOUDFLARE_ZONE_ID: 'zone-123',
  BACI_NEXT_DEPLOYMENT_ID_SOURCE: MARKER,
  STOREFRONT_RELEASE_ATTEMPTS: '2',
  STOREFRONT_RELEASE_BASE_URL: 'https://ogabassey.com',
  STOREFRONT_RELEASE_RETRY_DELAY_MS: '1',
  STOREFRONT_RELEASE_TIMEOUT_MS: '1000',
};
const BASE_URL = ENV.STOREFRONT_RELEASE_BASE_URL;
const PDP_PATH = '/smartphones/pixel-9-pro';

function html(marker = MARKER, extra = '') {
  return `<html data-dpl-id="${marker}"><link href="/a.css?dpl=${marker}">${extra}</html>`;
}

function response(body, status = 200) {
  return {
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

function makeSuccessfulFetch(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ options, url });
    if (overrides.fetchImpl) return overrides.fetchImpl(url, options, calls);
    const extra = new URL(url).pathname === '/products' ? `<a href="${PDP_PATH}">Phone</a>` : '';
    return response(html(MARKER, extra));
  };
  return { calls, fetchImpl };
}

async function successfulReleasePurge({ canaryUrls }) {
  return { skipped: false, urls: canaryUrls };
}

test('extracts one deployment marker and rejects missing or mixed markers', () => {
  assert.equal(extractDeploymentMarker(html()), MARKER);
  assert.throws(() => extractDeploymentMarker('<html></html>'), /Missing dpl marker/);
  assert.throws(
    () => extractDeploymentMarker('<html data-dpl-id="old"><link href="/a.css?dpl=new">'),
    /Mixed dpl markers.*old, new/
  );
});

test('discovers a PDP and builds only the five exact origin HTML canaries', () => {
  assert.equal(
    discoverPdpPath(
      '<a href="/products">All</a><a href="/smartphones/pixel-9-pro">Pixel</a>',
      ENV.STOREFRONT_RELEASE_BASE_URL
    ),
    PDP_PATH
  );
  const urls = buildCanaryUrls(ENV.STOREFRONT_RELEASE_BASE_URL, PDP_PATH);
  assert.deepEqual(urls, [
    'https://ogabassey.com/',
    'https://ogabassey.com/products',
    'https://ogabassey.com/smartphones',
    'https://ogabassey.com/smartphones/pixel-9-pro',
    'https://ogabassey.com/blog',
  ]);
  assert.ok(urls.every((url) => !url.includes('cdn.ogabassey.com/images')));
  assert.throws(
    () => buildCanaryUrls(ENV.STOREFRONT_RELEASE_BASE_URL, '/products?page=2'),
    /same-origin path without query/
  );
});

test('delegates whole-site purge then verifies browser and Googlebot canaries', async () => {
  const { calls, fetchImpl } = makeSuccessfulFetch();
  const purgeCalls = [];
  const result = await runReleaseCoherence({
    env: ENV,
    fetchImpl,
    logger: { log: () => {}, warn: () => {} },
    releasePurgeImpl: async (options) => {
      purgeCalls.push(options);
      return { skipped: false, urls: [...options.canaryUrls, `${BASE_URL}/faq`] };
    },
    requestId: 'request-1',
  });

  assert.equal(result.marker, MARKER);
  assert.equal(result.pdpPath, PDP_PATH);
  assert.equal(purgeCalls.length, 1);
  assert.deepEqual(purgeCalls[0].canaryUrls, result.urls);
  assert.deepEqual(result.purgedUrls, [...result.urls, `${BASE_URL}/faq`]);

  const warmCalls = calls.filter(({ url }) => !new URL(url).search);
  assert.equal(warmCalls.length, 10);
  assert.deepEqual(new Set(warmCalls.map(({ url }) => url)), new Set(result.urls));
  assert.deepEqual(
    new Set(warmCalls.map(({ options }) => options.headers['user-agent'])),
    new Set(Object.values(RELEASE_USER_AGENTS))
  );
});

test('fails after purge when a stale products response does not reach the configured marker', async () => {
  let purgeCalls = 0;
  let hostPurgeCalls = 0;
  const { fetchImpl } = makeSuccessfulFetch({
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      const marker = parsed.pathname === '/products' ? 'other_release' : MARKER;
      return response(html(marker, `<a href="${PDP_PATH}">Phone</a>`));
    },
  });

  await assert.rejects(
    () =>
      runReleaseCoherence({
        env: ENV,
        fetchImpl,
        hostPurgeImpl: async () => {
          hostPurgeCalls += 1;
          return { skipped: false };
        },
        logger: { log: () => {}, warn: () => {} },
        releasePurgeImpl: async () => {
          purgeCalls += 1;
          return { skipped: false };
        },
        requestId: 'request-marker-skew',
      }),
    /browser https:\/\/ogabassey\.com\/products: expected release_123, received other_release/
  );
  assert.equal(purgeCalls, 1);
  assert.equal(hostPurgeCalls, 1);
});

test('fails after bounded retries when a canonical response keeps an old marker', async () => {
  let staleCalls = 0;
  let sleepCalls = 0;
  const { fetchImpl } = makeSuccessfulFetch({
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      const isStaleTarget =
        !parsed.search &&
        parsed.pathname === '/products' &&
        options.headers['user-agent'] === RELEASE_USER_AGENTS.browser;
      if (isStaleTarget) {
        staleCalls += 1;
        return response(html('old_release'));
      }
      const extra = parsed.pathname === '/products' ? `<a href="${PDP_PATH}">Phone</a>` : '';
      return response(html(MARKER, extra));
    },
  });

  await assert.rejects(
    () =>
      runReleaseCoherence({
        // One verification attempt after the hostname-purge fallback keeps the arithmetic simple.
        env: { ...ENV, STOREFRONT_RELEASE_ESCALATION_ATTEMPTS: '1' },
        fetchImpl,
        hostPurgeImpl: async () => ({ skipped: false }),
        logger: { log: () => {}, warn: () => {} },
        releasePurgeImpl: successfulReleasePurge,
        requestId: 'request-old-canonical',
        sleep: async () => {
          sleepCalls += 1;
        },
      }),
    /browser https:\/\/ogabassey\.com\/products: expected release_123, received old_release/
  );
  // 2 normal attempts + 1 attempt after the hostname purge; one wait between the normal attempts.
  assert.equal(staleCalls, 3);
  assert.equal(sleepCalls, 1);
});

test('fails closed when the whole-site purge is skipped', async () => {
  const { calls, fetchImpl } = makeSuccessfulFetch();

  await assert.rejects(
    () =>
      runReleaseCoherence({
        env: ENV,
        fetchImpl,
        logger: { log: () => {}, warn: () => {} },
        releasePurgeImpl: async () => ({ reason: 'missing-token', skipped: true }),
        requestId: 'request-skipped-purge',
      }),
    /Storefront HTML purge was skipped: missing-token/
  );
  assert.equal(calls.length, 2);
});

test('normalizes non-Error canonical fetch failures in diagnostics', async () => {
  await assert.rejects(
    () =>
      warmAndAssertCanaries({
        attempts: 1,
        expectedMarker: MARKER,
        fetchImpl: async () => {
          throw 'socket closed';
        },
        logger: { log: () => {}, warn: () => {} },
        retryDelayMs: 1,
        timeoutMs: 1000,
        urls: ['https://ogabassey.com/'],
      }),
    /browser https:\/\/ogabassey\.com\/: socket closed/
  );
});

test('fails on a non-2xx promoted release probe', async () => {
  await assert.rejects(
    () =>
      runReleaseCoherence({
        env: ENV,
        fetchImpl: async () => response('unavailable', 503),
        logger: { log: () => {}, warn: () => {} },
        releasePurgeImpl: async () => assert.fail('purge should not run'),
        requestId: 'request-3',
      }),
    /cache-busted canonical home returned HTTP 503/
  );
});

test('fails before network work when Cloudflare credentials are missing', async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return response(html());
  };

  await assert.rejects(
    () => runReleaseCoherence({ env: { ...ENV, CLOUDFLARE_API_TOKEN: '' }, fetchImpl }),
    /CLOUDFLARE_API_TOKEN is required/
  );
  await assert.rejects(
    () => runReleaseCoherence({ env: { ...ENV, CLOUDFLARE_ZONE_ID: '' }, fetchImpl }),
    /CLOUDFLARE_ZONE_ID is required/
  );
  await assert.rejects(
    () =>
      runReleaseCoherence({
        env: { ...ENV, BACI_NEXT_DEPLOYMENT_ID_SOURCE: '' },
        fetchImpl,
      }),
    /BACI_NEXT_DEPLOYMENT_ID_SOURCE must yield a safe storefront release marker/
  );
  assert.equal(fetchCalls, 0);
});

test('bounds retry and timeout configuration', () => {
  assert.throws(
    () => readReleaseConfig({ ...ENV, STOREFRONT_RELEASE_ATTEMPTS: '11' }),
    /between 1 and 10/
  );
  assert.throws(
    () => readReleaseConfig({ ...ENV, STOREFRONT_RELEASE_TIMEOUT_MS: '60001' }),
    /between 1 and 60000/
  );
});

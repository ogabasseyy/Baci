import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RELEASE_USER_AGENTS,
  runReleaseCoherence,
} from './storefront-release-coherence.mjs';

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

test('uses the configured deployment marker after cache-busted discovery sees stale responses', async () => {
  let purgeCalls = 0;
  let staleDiscoveryCalls = 0;
  const { fetchImpl } = makeSuccessfulFetch({
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      const isCacheBustedDiscovery = Boolean(parsed.search);
      if (isCacheBustedDiscovery) staleDiscoveryCalls += 1;
      const marker = isCacheBustedDiscovery
        ? parsed.pathname === '/products'
          ? 'stale_products_release'
          : 'stale_home_release'
        : MARKER;
      const extra =
        parsed.pathname === '/products' ? `<a href="${PDP_PATH}">Phone</a>` : '';
      return response(html(marker, extra));
    },
  });

  const result = await runReleaseCoherence({
    env: ENV,
    fetchImpl,
    logger: { log: () => {}, warn: () => {} },
    releasePurgeImpl: async ({ canaryUrls }) => {
      purgeCalls += 1;
      return { skipped: false, urls: canaryUrls };
    },
    requestId: 'request-stale-discovery',
  });

  assert.equal(result.marker, MARKER);
  assert.ok(staleDiscoveryCalls > 0);
  assert.equal(purgeCalls, 1);
});

test('retries a stale warm response within the configured bound', async () => {
  let staleResponses = 0;
  let sleepCalls = 0;
  const sleepDelays = [];
  const { calls, fetchImpl } = makeSuccessfulFetch({
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      const isWarmBrowserProducts =
        !parsed.search &&
        parsed.pathname === '/products' &&
        options.headers['user-agent'] === RELEASE_USER_AGENTS.browser;
      if (isWarmBrowserProducts && staleResponses++ === 0) return response(html('old_release'));
      const extra = parsed.pathname === '/products' ? `<a href="${PDP_PATH}">Phone</a>` : '';
      return response(html(MARKER, extra));
    },
  });

  await runReleaseCoherence({
    env: ENV,
    fetchImpl,
    logger: { log: () => {}, warn: () => {} },
    releasePurgeImpl: successfulReleasePurge,
    requestId: 'request-2',
    sleep: async (delayMs) => {
      sleepCalls += 1;
      sleepDelays.push(delayMs);
    },
  });

  assert.equal(sleepCalls, 1);
  assert.deepEqual(sleepDelays, [1]);
  assert.equal(
    calls.filter(
      ({ options, url }) =>
        !new URL(url).search &&
        new URL(url).pathname === '/products' &&
        options.headers['user-agent'] === RELEASE_USER_AGENTS.browser
    ).length,
    2
  );
});

test('stops after the configured warm retry bound when stale responses persist', async () => {
  let warmBrowserCalls = 0;
  let sleepCalls = 0;
  let hostPurgeCalls = 0;
  const { fetchImpl } = makeSuccessfulFetch({
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      const isWarmBrowserRequest =
        !parsed.search &&
        options.headers['user-agent'] === RELEASE_USER_AGENTS.browser;
      if (isWarmBrowserRequest) {
        warmBrowserCalls += 1;
        return response(html('old_release'));
      }
      const extra = parsed.pathname === '/products' ? `<a href="${PDP_PATH}">Phone</a>` : '';
      return response(html(MARKER, extra));
    },
  });

  await assert.rejects(
    runReleaseCoherence({
      // One verification attempt after the hostname-purge fallback keeps the arithmetic simple.
      env: { ...ENV, STOREFRONT_RELEASE_ESCALATION_ATTEMPTS: '1' },
      fetchImpl,
      hostPurgeImpl: async () => {
        hostPurgeCalls += 1;
        return { skipped: false };
      },
      logger: { log: () => {}, warn: () => {} },
      releasePurgeImpl: successfulReleasePurge,
      requestId: 'request-retry-exhaustion',
      sleep: async () => {
        sleepCalls += 1;
      },
    }),
    /Storefront release coherence failed after the Cloudflare hostname purge/,
  );

  // 5 canaries x (2 normal attempts + 1 attempt after the hostname purge); one wait between
  // the two normal attempts, none after the last attempt of either window.
  assert.equal(warmBrowserCalls, 15);
  assert.equal(sleepCalls, 1);
  assert.equal(hostPurgeCalls, 1);
});

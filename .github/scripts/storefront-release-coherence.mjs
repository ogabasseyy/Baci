#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  buildCanaryUrls,
  discoverPdpPath,
  normalizePdpPath,
} from './storefront-release-coherence-canary-urls.mjs';
import {
  describeCacheHeaders,
  verifyWithHostPurgeFallback,
} from './storefront-release-coherence-escalation.mjs';
import { readReleaseConfig } from './storefront-release-config.mjs';
import { buildReleaseProbeUrl, purgeSitemapBackedHtml } from './storefront-sitemap-purge.mjs';

export { buildCanaryUrls, discoverPdpPath };

export const RELEASE_USER_AGENTS = Object.freeze({
  browser:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  googlebot:
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
});

export function extractDeploymentMarker(html, label = 'HTML response') {
  const markers = new Set();
  for (const match of String(html).matchAll(/data-dpl-id=["']([^"']+)["']/g)) {
    markers.add(match[1]);
  }
  // Only inspect real HTML asset attributes. Next's streamed RSC payload can
  // split an escaped URL between script chunks, which would look like a
  // second, truncated marker if arbitrary body text were scanned.
  for (const match of String(html).matchAll(/(?:href|src)=["'][^"']*[?&]dpl=([\w-]+)/g)) {
    markers.add(match[1]);
  }

  if (markers.size === 0) throw new Error(`Missing dpl marker in ${label}`);
  if (markers.size > 1) {
    throw new Error(`Mixed dpl markers in ${label}: ${[...markers].join(', ')}`);
  }
  return markers.values().next().value;
}

async function fetchMarkedHtml({ fetchImpl = fetch, label, timeoutMs, url, userAgent }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': userAgent,
      },
      redirect: 'manual',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('text/html')) {
      throw new Error(`${label} returned non-HTML content: ${contentType || 'missing content-type'}`);
    }
    const html = await response.text();
    return {
      cache: describeCacheHeaders(response.headers),
      html,
      marker: extractDeploymentMarker(html, label),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeReleaseDocumentRoutes({
  baseUrl,
  fetchImpl = fetch,
  pdpPath,
  requestId = randomUUID(),
  timeoutMs,
}) {
  await fetchMarkedHtml({
    fetchImpl,
    label: 'cache-busted canonical home',
    timeoutMs,
    url: buildReleaseProbeUrl(baseUrl, '/', `${requestId}-home`),
    userAgent: RELEASE_USER_AGENTS.browser,
  });
  const products = await fetchMarkedHtml({
    fetchImpl,
    label: 'cache-busted products page',
    timeoutMs,
    url: buildReleaseProbeUrl(baseUrl, '/products', `${requestId}-products`),
    userAgent: RELEASE_USER_AGENTS.browser,
  });
  return {
    pdpPath: pdpPath ? normalizePdpPath(pdpPath, baseUrl) : discoverPdpPath(products.html, baseUrl),
  };
}

export async function warmAndAssertCanaries({
  attempts,
  expectedMarker,
  fetchImpl = fetch,
  logger = console,
  retryDelayMs,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs,
  urls,
}) {
  let pending = Object.entries(RELEASE_USER_AGENTS).flatMap(([variant, userAgent]) =>
    urls.map((url) => ({ userAgent, url, variant }))
  );
  let failures = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const results = await Promise.all(
      pending.map(async (target) => {
        try {
          const response = await fetchMarkedHtml({
            fetchImpl,
            label: `${target.variant} ${target.url}`,
            timeoutMs,
            url: target.url,
            userAgent: target.userAgent,
          });
          if (response.marker !== expectedMarker) {
            const mismatch = new Error(
              `expected ${expectedMarker}, received ${response.marker}${response.cache}`
            );
            // A page purge can fix a stale copy; it cannot fix a 5xx, timeout or missing marker.
            mismatch.stale = true;
            throw mismatch;
          }
          return { ok: true, target };
        } catch (error) {
          return { error: error instanceof Error ? error : new Error(String(error)), ok: false, target };
        }
      })
    );

    failures = results.filter((result) => !result.ok);
    pending = failures.map((failure) => failure.target);
    if (pending.length === 0) {
      logger.log(`Verified ${urls.length} storefront HTML canaries for browser and Googlebot.`);
      return;
    }
    if (attempt < attempts) {
      logger.warn(`Release coherence attempt ${attempt} left ${pending.length} canary response(s); retrying.`);
      await sleep(retryDelayMs);
    }
  }

  const details = failures
    .map(({ error, target }) => `${target.variant} ${target.url}: ${error.message}`)
    .join('; ');
  const failure = new Error(`Storefront release coherence failed: ${details}`);
  // A hostname purge is only a candidate fix when EVERY remaining failure is an old-release copy:
  // a 5xx, timeout or missing marker on another page means a partial outage, where Cloudflare may
  // be serving stale-if-error copies that a purge would delete.
  failure.stale = failures.length > 0 && failures.every(({ error }) => error.stale === true);
  failure.staleUrls = [...new Set(failures.map(({ target }) => target.url))];
  throw failure;
}

export async function runReleaseCoherence(options = {}) {
  const config = readReleaseConfig(options.env);
  const requestId = options.requestId || randomUUID();
  const probe = await probeReleaseDocumentRoutes({ ...config, ...options, requestId });
  const urls = buildCanaryUrls(config.baseUrl, probe.pdpPath);
  const logger = options.logger || console;
  logger.log(
    `Expected storefront dpl ${config.expectedMarker}; discovering canonical sitemap URLs.`
  );
  const purge = await (options.releasePurgeImpl || purgeSitemapBackedHtml)({
    baseUrl: config.baseUrl,
    canaryUrls: urls,
    cloudflareFetchJson: options.cloudflareFetchJson,
    env: options.env,
    fetchImpl: options.fetchImpl,
    logger,
    purgeImpl: options.purgeImpl,
    requestId,
    sleep: options.sleep,
    timeoutMs: config.timeoutMs,
    token: config.token,
    userAgent: RELEASE_USER_AGENTS.browser,
    zoneId: config.zoneId,
  });
  if (purge.skipped) throw new Error(`Storefront HTML purge was skipped: ${purge.reason}`);
  const { escalated } = await verifyWithHostPurgeFallback({
    baseUrl: config.baseUrl,
    cloudflareFetchJson: options.cloudflareFetchJson,
    config,
    hostPurgeImpl: options.hostPurgeImpl,
    logger,
    // Cache-busted copy of the same page, so it reads the origin (Vercel), never a Cloudflare copy.
    probeOrigin: async (canaryUrl, index) =>
      (
        await fetchMarkedHtml({
          fetchImpl: options.fetchImpl,
          label: 'cache-busted origin probe',
          timeoutMs: config.timeoutMs,
          url: buildReleaseProbeUrl(
            config.baseUrl,
            new URL(canaryUrl).pathname,
            `${requestId}-origin-${index}`
          ),
          userAgent: RELEASE_USER_AGENTS.browser,
        })
      ).marker,
    sleep: options.sleep,
    verify: ({ attempts, retryDelayMs }) =>
      warmAndAssertCanaries({
        ...config,
        ...options,
        attempts,
        expectedMarker: config.expectedMarker,
        logger,
        retryDelayMs,
        urls,
      }),
  });
  return {
    escalated,
    marker: config.expectedMarker,
    pdpPath: probe.pdpPath,
    purgedUrls: purge.urls,
    urls,
  };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runReleaseCoherence().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

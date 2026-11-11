// Fallback for the storefront release-coherence check.
//
// The page-by-page Cloudflare purge (storefront-sitemap-purge.mjs) stays the first line:
// it is targeted and never touches other hostnames. Since 2026-11-11 04:03 UTC Cloudflare has
// accepted those purge calls (HTTP 200, right zone) but kept serving the previous release's
// HTML from cache, so every deploy went red. A hostname purge (`{ hosts: [...] }`) still evicts
// those copies. NOTE: a hostname purge clears ALL cached content for those hostnames (HTML,
// same-host assets and API responses, not just the canaries); it refills from the origin on
// demand. It is used ONLY when every canary still failing shows an older release after the
// normal retry window and the origin is proven healthy on the new release for each of those
// pages; the check afterwards stays just as strict. It never sends `purge_everything` and never
// targets a cdn.* hostname. Owner approved this fallback on 2026-11-11 (previously the check was
// "single-file URL purge only", PR #3067).
import { buildHostPurgePayload, purgeCloudflareHosts } from './cloudflare-purge-cache.mjs';
import { isRetryablePurgeError, retryDelay } from './storefront-sitemap-purge.mjs';

const DEFAULT_HOST_PURGE_ATTEMPTS = 4;
const DEFAULT_HOST_PURGE_RETRY_DELAY_MS = 1_000;
const DEFAULT_HOST_PURGE_MAX_RETRY_DELAY_MS = 30_000;

/**
 * Compact Cloudflare/Vercel cache details for a canary response, e.g.
 * ` [cf-cache-status=HIT age=224s x-vercel-cache=HIT filled=08:50:17Z cf-ray=...-MAN]`.
 * `filled` is when Cloudflare last fetched the page from Vercel (the millisecond
 * timestamp inside x-vercel-id), which shows whether a copy pre-dates the purge.
 * It is a best-effort heuristic: the `region::id-<epoch ms>-hash` shape of x-vercel-id is
 * observed, not a documented contract, so if Vercel changes it `filled` is simply omitted.
 * Read a missing `filled` as "unknown", never as a cache-timing signal.
 */
export function describeCacheHeaders(headers) {
  const parts = [];
  const add = (label, value) => {
    if (value) parts.push(`${label}=${value}`);
  };
  add('cf-cache-status', headers.get('cf-cache-status'));
  add('age', headers.get('age') && `${headers.get('age')}s`);
  add('x-vercel-cache', headers.get('x-vercel-cache'));
  const filledMs = /\b(\d{13})\b/.exec(headers.get('x-vercel-id') || '')?.[1];
  if (filledMs) add('filled', `${new Date(Number(filledMs)).toISOString().slice(11, 19)}Z`);
  add('cf-ray', headers.get('cf-ray'));
  return parts.length > 0 ? ` [${parts.join(' ')}]` : '';
}

export function releaseHostsFor(baseUrl) {
  const apex = new URL(baseUrl).hostname.toLowerCase().replace(/^www\./, '');
  // buildHostPurgePayload enforces the hostname rules (DNS name only, never cdn.*, no IPs).
  return buildHostPurgePayload([apex, `www.${apex}`]).hosts;
}

export async function purgeReleaseHosts({
  attempts = DEFAULT_HOST_PURGE_ATTEMPTS,
  cloudflareFetchJson,
  hosts,
  logger = console,
  maxRetryDelayMs = DEFAULT_HOST_PURGE_MAX_RETRY_DELAY_MS,
  retryDelayMs = DEFAULT_HOST_PURGE_RETRY_DELAY_MS,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  token,
  zoneId,
}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await purgeCloudflareHosts({
        fetchJson: cloudflareFetchJson,
        hosts,
        logger,
        token,
        zoneId,
      });
      if (!result || result.skipped) {
        throw new Error(`Cloudflare hostname purge was skipped: ${result?.reason || 'unknown'}`);
      }
      return result;
    } catch (error) {
      if (attempt === attempts || !isRetryablePurgeError(error)) throw error;
      logger.warn(`Cloudflare hostname purge attempt ${attempt} failed; retrying.`);
      await sleep(retryDelay(error, attempt, retryDelayMs, maxRetryDelayMs));
    }
  }
}

// `verify` is injectable, so the shape of the targets it attaches to a stale failure is not
// trusted: a malformed one must fail closed with a clear message, before any probe or purge.
function describeInvalidStaleTarget(target) {
  if (typeof target?.url !== 'string' || typeof target.variant !== 'string') {
    return 'it needs a url and a variant';
  }
  try {
    const { protocol } = new URL(target.url);
    return protocol === 'https:' || protocol === 'http:' ? null : `${target.url} is not an http(s) URL`;
  } catch {
    return `${target.url} is not a valid URL`;
  }
}

/**
 * Runs `verify` with the normal retry window. If canaries are still on an older release
 * (`error.stale`) AND the origin serves the expected release, sends one hostname purge and
 * verifies again with the bounded escalation window. Any other failure is re-thrown unchanged.
 */
export async function verifyWithHostPurgeFallback({
  baseUrl,
  cloudflareFetchJson,
  config,
  hostPurgeImpl = purgeReleaseHosts,
  logger = console,
  probeOrigin,
  sleep,
  verify,
}) {
  try {
    await verify({ attempts: config.attempts, retryDelayMs: config.retryDelayMs });
    return { escalated: false };
  } catch (error) {
    if (!error?.stale) throw error;

    // Purge only when the origin is proven healthy AND on the expected release for EVERY stale
    // (page, variant) target, probed with that variant's own user agent: the browser and Googlebot
    // renders are distinct origin paths, so a healthy browser render proves nothing about the bot's.
    // If the origin is erroring, Cloudflare may be serving stale pages as a fallback
    // (stale-if-error) and a hostname purge would delete exactly those copies; if the origin
    // serves another release, a purge cannot help.
    // Fail closed: with no stale targets there is nothing to prove the origin healthy for, and
    // this function is exported with an injectable `verify`, so never purge without that gate.
    const staleTargets = Array.isArray(error.staleTargets) ? error.staleTargets : [];
    if (staleTargets.length === 0) throw error;
    for (const target of staleTargets) {
      const problem = describeInvalidStaleTarget(target);
      if (problem) {
        throw new Error(
          `${error.message}; invalid stale target (${problem}), so no hostname purge was attempted`,
          { cause: error }
        );
      }
    }
    const probes = await Promise.all(
      staleTargets.map(async (target, index) => {
        try {
          return { marker: await probeOrigin(target, index), target };
        } catch (probeError) {
          return { probeError, target };
        }
      })
    );
    for (const { marker, probeError, target } of probes) {
      const { pathname } = new URL(target.url);
      if (probeError) {
        throw new Error(
          `${error.message}; origin probe failed for ${target.variant} ${pathname} (${probeError.message}), so no hostname purge was attempted`,
          { cause: error }
        );
      }
      if (marker !== config.expectedMarker) {
        throw new Error(
          `${error.message}; the origin itself serves ${marker} on ${pathname} (${target.variant}), so a Cloudflare purge cannot fix this`,
          { cause: error }
        );
      }
    }

    const hosts = releaseHostsFor(baseUrl);
    logger.warn(
      `Page purge left older release HTML on the canaries; escalating to a Cloudflare hostname purge for ${hosts.join(', ')}. The hostname purge clears ALL cached content for those hostnames (HTML, assets, API responses) and refills from the origin on demand. ${error.message}`
    );
    await hostPurgeImpl({
      cloudflareFetchJson,
      hosts,
      logger,
      sleep,
      token: config.token,
      zoneId: config.zoneId,
    });

    try {
      await verify({
        attempts: config.escalationAttempts,
        retryDelayMs: config.escalationRetryDelayMs,
      });
    } catch (second) {
      throw new Error(
        second.message.replace(
          'Storefront release coherence failed',
          'Storefront release coherence failed after the Cloudflare hostname purge'
        ),
        { cause: second }
      );
    }
    logger.log('The Cloudflare hostname purge cleared the older release HTML from the canaries.');
    return { escalated: true };
  }
}

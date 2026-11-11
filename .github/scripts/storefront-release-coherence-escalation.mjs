// Fallback for the storefront release-coherence check.
//
// The page-by-page Cloudflare purge (storefront-sitemap-purge.mjs) stays the first line:
// it is targeted and never touches other hostnames. Since 2026-11-11 04:03 UTC Cloudflare has
// accepted those purge calls (HTTP 200, right zone) but kept serving the previous release's
// HTML from cache, so every deploy went red. A hostname purge (`{ hosts: [...] }`) still evicts
// those copies. It is used ONLY when canaries still show an older release after the normal
// retry window, and the check afterwards stays just as strict. It never sends
// `purge_everything` and never targets a cdn.* hostname. Owner approved this fallback on
// 2026-11-11 (previously the check was "single-file URL purge only", PR #3067).
import { purgeCloudflareHosts } from './cloudflare-purge-cache.mjs';
import { isRetryablePurgeError, retryDelay } from './storefront-sitemap-purge.mjs';

const DEFAULT_HOST_PURGE_ATTEMPTS = 4;
const DEFAULT_HOST_PURGE_RETRY_DELAY_MS = 1_000;
const DEFAULT_HOST_PURGE_MAX_RETRY_DELAY_MS = 30_000;
const DNS_HOSTNAME =
  /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/**
 * Compact Cloudflare/Vercel cache details for a canary response, e.g.
 * ` [cf-cache-status=HIT age=224s x-vercel-cache=HIT filled=08:50:17Z cf-ray=...-MAN]`.
 * `filled` is when Cloudflare last fetched the page from Vercel (the millisecond
 * timestamp inside x-vercel-id), which shows whether a copy pre-dates the purge.
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
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  if (!DNS_HOSTNAME.test(hostname) || /^\d+(?:\.\d+){3}$/.test(hostname)) {
    throw new Error(`Release hostname purge requires a DNS hostname, received ${hostname}`);
  }
  if (hostname.startsWith('cdn.')) {
    throw new Error('Release hostname purge must never target cdn.* hostnames');
  }
  const apex = hostname.replace(/^www\./, '');
  return [apex, `www.${apex}`];
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

    // Purge only when the origin is proven healthy AND on the expected release. If the origin
    // is erroring, Cloudflare may be serving stale pages as a fallback (stale-if-error) and a
    // hostname purge would delete exactly those copies; if the origin serves another release, a
    // purge cannot help.
    let originMarker;
    try {
      originMarker = await probeOrigin();
    } catch (probeError) {
      throw new Error(
        `${error.message}; origin probe failed (${probeError.message}), so no hostname purge was attempted`,
        { cause: error }
      );
    }
    if (originMarker !== config.expectedMarker) {
      throw new Error(
        `${error.message}; the origin itself serves ${originMarker}, so a Cloudflare purge cannot fix this`,
        { cause: error }
      );
    }

    const hosts = releaseHostsFor(baseUrl);
    logger.warn(
      `Page purge left older release HTML on the canaries; escalating to a Cloudflare hostname purge for ${hosts.join(', ')}. ${error.message}`
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

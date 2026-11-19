import { getCloudflarePurgeCredentials } from '@/lib/cloudflare-purge-credentials';

/**
 * Best-effort Cloudflare edge cache purge for the storefront custom domains.
 *
 * Cloudflare sits in front of the storefront (ogabassey.com → Vercel), so a
 * longer edge TTL only stays correct if we actively evict mutated URLs. The
 * default helper is called fire-and-forget from revalidation paths; it MUST
 * NEVER throw or reject in a way that breaks those callers. Publication-state
 * transitions use the confirmed foreground variant exported below.
 *
 * Fail-open contract:
 *   - Missing CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID → warn once, no-op.
 *   - Network error / non-2xx response → warn (not once) and continue.
 */

const CLOUDFLARE_PURGE_API_BASE = 'https://api.cloudflare.com/client/v4/zones';
// Cloudflare's single-file purge endpoint accepts at most 30 URLs per request
// on non-Enterprise plans; larger lists are chunked into sequential requests.
export const CLOUDFLARE_PURGE_MAX_URLS_PER_BATCH = 30;
export const CLOUDFLARE_PURGE_DEFAULT_TIMEOUT_MS = 5000;
const MAX_URLS_PER_BATCH = CLOUDFLARE_PURGE_MAX_URLS_PER_BATCH;
const DEFAULT_PURGE_TIMEOUT_MS = CLOUDFLARE_PURGE_DEFAULT_TIMEOUT_MS;

let hasWarnedMissingConfig = false;

function warnMissingConfigOnce(): void {
  if (hasWarnedMissingConfig) {
    return;
  }
  hasWarnedMissingConfig = true;
  console.warn(
    'Cloudflare cache purge skipped: CLOUDFLARE_API_TOKEN and/or CLOUDFLARE_ZONE_ID are not configured. Edge caches will self-heal on their TTL.'
  );
}

function chunkUrls(urls: string[], size: number): string[][] {
  const batches: string[][] = [];
  for (let index = 0; index < urls.length; index += size) {
    batches.push(urls.slice(index, index + size));
  }
  return batches;
}

export interface PurgeCloudflareUrlsOptions {
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

export type CloudflarePurgeConfirmation =
  | { ok: true; reason: 'not_required' | 'purged' }
  | {
      ok: false;
      reason: 'missing_configuration' | 'provider_rejected' | 'request_failed';
    };

async function executeCloudflarePurge(
  items: string[],
  payloadKey: 'files' | 'hosts',
  options: PurgeCloudflareUrlsOptions
): Promise<CloudflarePurgeConfirmation> {
  const uniqueItems = Array.from(
    new Set(
      items.filter(
        (item): item is string => typeof item === 'string' && item.length > 0
      )
    )
  );
  if (uniqueItems.length === 0) {
    return { ok: true, reason: 'not_required' };
  }

  const credentials = getCloudflarePurgeCredentials();
  if (!credentials) {
    warnMissingConfigOnce();
    return { ok: false, reason: 'missing_configuration' };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${CLOUDFLARE_PURGE_API_BASE}/${encodeURIComponent(
    credentials.zoneId
  )}/purge_cache`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PURGE_TIMEOUT_MS;
  let providerRejected = false;
  let requestFailed = false;

  for (const batch of chunkUrls(uniqueItems, MAX_URLS_PER_BATCH)) {
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ [payloadKey]: batch }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        requestFailed = true;
        console.warn(
          'Cloudflare cache purge returned a non-2xx response; relying on TTL self-heal',
          { status: response.status, count: batch.length }
        );
      } else {
        const payload = await response.json().catch(() => null);
        if (
          !payload ||
          typeof payload !== 'object' ||
          !('success' in payload) ||
          payload.success !== true
        ) {
          providerRejected = true;
          console.warn(
            'Cloudflare cache purge was not confirmed by the provider payload',
            { count: batch.length }
          );
        }
      }
    } catch (error) {
      requestFailed = true;
      console.warn(
        'Cloudflare cache purge request failed; relying on TTL self-heal',
        { error, count: batch.length }
      );
    }
  }

  if (requestFailed) {
    return { ok: false, reason: 'request_failed' };
  }
  if (providerRejected) {
    return { ok: false, reason: 'provider_rejected' };
  }
  return { ok: true, reason: 'purged' };
}

/**
 * Purge the given absolute URLs from Cloudflare's edge cache.
 * Silently no-ops on empty input or missing configuration, and swallows all
 * network/API errors so a purge failure never propagates to the caller.
 */
export async function purgeCloudflareUrls(
  urls: string[],
  options: PurgeCloudflareUrlsOptions = {}
): Promise<void> {
  await executeCloudflarePurge(urls, 'files', options);
}

/**
 * Foreground variant for availability-boundary mutations. Unlike the normal
 * fail-open helper, callers receive confirmation and can refuse to claim the
 * mutation is fully propagated when the external edge eviction did not land.
 */
export function purgeCloudflareUrlsConfirmed(
  urls: string[],
  options: PurgeCloudflareUrlsOptions = {}
): Promise<CloudflarePurgeConfirmation> {
  return executeCloudflarePurge(urls, 'files', options);
}

/**
 * Confirmed hostname-wide purge for publication transitions. This evicts every
 * cached storefront document for each public alias, including category, PDP,
 * blog, and trust routes that cannot be enumerated safely at mutation time.
 */
export function purgeCloudflareHostnamesConfirmed(
  hostnames: string[],
  options: PurgeCloudflareUrlsOptions = {}
): Promise<CloudflarePurgeConfirmation> {
  return executeCloudflarePurge(hostnames, 'hosts', options);
}

import { readExpectedStorefrontReleaseMarker } from './storefront-release-marker.mjs';

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 20_000;
// Verification window after the hostname-purge fallback (~35 s at the defaults): the
// purge is accepted at once but the cache is observed empty a few seconds to ~30 s later.
const DEFAULT_ESCALATION_ATTEMPTS = 8;
const DEFAULT_ESCALATION_RETRY_DELAY_MS = 5_000;

function parseBoundedInteger(value, fallback, name, maximum) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

export function readReleaseConfig(env = process.env) {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const zoneId = env.CLOUDFLARE_ZONE_ID?.trim();
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required for release coherence');
  if (!zoneId) throw new Error('CLOUDFLARE_ZONE_ID is required for release coherence');

  const baseUrl = new URL(env.STOREFRONT_RELEASE_BASE_URL || 'https://ogabassey.com');
  if (baseUrl.protocol !== 'https:' || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
    throw new Error('STOREFRONT_RELEASE_BASE_URL must be an HTTPS origin');
  }

  return {
    attempts: parseBoundedInteger(
      env.STOREFRONT_RELEASE_ATTEMPTS,
      DEFAULT_ATTEMPTS,
      'STOREFRONT_RELEASE_ATTEMPTS',
      10
    ),
    baseUrl: baseUrl.origin,
    escalationAttempts: parseBoundedInteger(
      env.STOREFRONT_RELEASE_ESCALATION_ATTEMPTS,
      DEFAULT_ESCALATION_ATTEMPTS,
      'STOREFRONT_RELEASE_ESCALATION_ATTEMPTS',
      10
    ),
    escalationRetryDelayMs: parseBoundedInteger(
      env.STOREFRONT_RELEASE_ESCALATION_RETRY_DELAY_MS,
      DEFAULT_ESCALATION_RETRY_DELAY_MS,
      'STOREFRONT_RELEASE_ESCALATION_RETRY_DELAY_MS',
      30_000
    ),
    expectedMarker: readExpectedStorefrontReleaseMarker(env),
    pdpPath: env.STOREFRONT_RELEASE_PDP_PATH?.trim() || '',
    retryDelayMs: parseBoundedInteger(
      env.STOREFRONT_RELEASE_RETRY_DELAY_MS,
      DEFAULT_RETRY_DELAY_MS,
      'STOREFRONT_RELEASE_RETRY_DELAY_MS',
      30_000
    ),
    timeoutMs: parseBoundedInteger(
      env.STOREFRONT_RELEASE_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      'STOREFRONT_RELEASE_TIMEOUT_MS',
      60_000
    ),
    token,
    zoneId,
  };
}

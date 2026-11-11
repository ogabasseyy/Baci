// Shared fakes for the storefront release-coherence escalation tests.
import { runReleaseCoherence } from './storefront-release-coherence.mjs';

export const MARKER = 'release_123';
export const OLD_MARKER = 'release_122';
export const PDP_PATH = '/smartphones/pixel-9-pro';
export const ENV = {
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
export const quietLogger = { log: () => {}, warn: () => {} };

export function html(marker, extra = '') {
  return `<html data-dpl-id="${marker}"><link href="/a.css?dpl=${marker}">${extra}</html>`;
}

export function response(body, { headers = {}, status = 200 } = {}) {
  return {
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8', ...headers }),
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

export const isOriginProbe = (url) =>
  Boolean(url.searchParams.get('__baci_release_probe')?.includes('-origin-'));

// A storefront whose canonical (no query) responses can stay on the previous release
// until `state.hostPurged` flips, like Cloudflare keeping an old copy after a page purge.
// Cache-busted requests (query present) read the "origin": the expected release unless
// `originMarker` says otherwise, or a 503 when `originFails(url)` says so.
export function makeStorefront({
  isStale = () => false,
  originFails = () => false,
  originMarker = MARKER,
  staleHeaders = {},
} = {}) {
  const state = { calls: [], hostPurged: false };
  const fetchImpl = async (value, options) => {
    const url = new URL(value);
    state.calls.push({ options, url });
    const extra = url.pathname === '/products' ? `<a href="${PDP_PATH}">Phone</a>` : '';
    if (url.search) {
      return originFails(url)
        ? response('unavailable', { status: 503 })
        : response(html(originMarker, extra));
    }
    if (!state.hostPurged && isStale(url, options, state)) {
      return response(html(OLD_MARKER, extra), { headers: staleHeaders });
    }
    return response(html(MARKER, extra));
  };
  return { fetchImpl, state };
}

export const productsOnly = (url) => url.pathname === '/products';

export function run(overrides) {
  return runReleaseCoherence({
    env: ENV,
    logger: quietLogger,
    releasePurgeImpl: async ({ canaryUrls }) => ({ skipped: false, urls: canaryUrls }),
    requestId: 'request-escalation',
    sleep: async () => {},
    ...overrides,
  });
}

/**
 * VPS worker: run-web-cron
 * Calls retained CRON_SECRET-gated web cron endpoints from the VPS schedule.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from 'dotenv';

// These paths expose CRON_SECRET-gated wrappers that delegate to the underlying
// scheduled work. The VPS worker must not call OAuth callbacks.
const WEB_CRON_CONFIG = new Map([
  ['/api/cron/drain-cache-invalidations', { method: 'GET', timeoutMs: 90_000 }],
  ['/api/ai-jobs/worker', { method: 'GET', timeoutMs: 15 * 60_000 }],
  ['/api/cron/alert-stuck-bnpl', { method: 'GET', timeoutMs: 5 * 60_000 }],
  ['/api/cron/merchant-signup-health', { method: 'GET', timeoutMs: 60_000 }],
  ['/api/cron/cleanup-orders', { method: 'GET', timeoutMs: 5 * 60_000 }],
  ['/api/cron/process-settlements', { method: 'POST', timeoutMs: 5 * 60_000 }],
  ['/api/cron/process-redvault-refunds', { method: 'POST', timeoutMs: 5 * 60_000 }],
  ['/api/cron/petrock-reconcile', { method: 'GET', timeoutMs: 5 * 60_000 }],
  [
    '/api/cron/publish-scheduled-posts',
    { method: 'GET', timeoutMs: 5 * 60_000 },
  ],
  [
    '/api/cron/vtu-cashback-summaries',
    { method: 'GET', timeoutMs: 5 * 60_000 },
  ],
  [
    '/api/cron/merchant-sales-summaries',
    { method: 'GET', timeoutMs: 5 * 60_000 },
  ],
  [
    '/api/cron/reconcile-vtu-processing',
    { method: 'GET', timeoutMs: 6 * 60_000 },
  ],
  [
    // 6-min client timeout gives headroom over the route's 300s maxDuration
    // so near-deadline runs are not aborted before response overhead lands
    // (mirrors reconcile-vtu-processing).
    '/api/cron/reconcile-gateway-paid-orders',
    { method: 'GET', timeoutMs: 6 * 60_000 },
  ],
  ['/api/cron/sync-petrock-catalog', { method: 'GET', timeoutMs: 5 * 60_000 }],
  [
    '/api/cron/agentic-commerce-health',
    { method: 'GET', timeoutMs: 5 * 60_000 },
  ],
  ['/api/cron/wallet-payouts', { method: 'GET', timeoutMs: 5 * 60_000 }],
  ['/api/cron/order-notifications', { method: 'GET', timeoutMs: 5 * 60_000 }],
  ['/api/quiz/finalize', { method: 'GET', timeoutMs: 5 * 60_000 }],
  ['/api/inventory/push-alerts', { method: 'GET', timeoutMs: 10 * 60_000 }],
  [
    '/api/cron/storefront-update-nudge',
    { method: 'GET', timeoutMs: 10 * 60_000 },
  ],
  ['/api/cron/ios-live-build-sync', { method: 'GET', timeoutMs: 60_000 }],
  ['/api/cron/android-live-build-sync', { method: 'GET', timeoutMs: 60_000 }],
]);

const RESPONSE_PREVIEW_LIMIT = 500;
const DEFAULT_TIMEOUT_MS = 30_000;
export const CACHE_INVALIDATION_DEAD_LETTER_CODE =
  'cache_invalidation_dead_letter';

function readTimeoutMs(value, fallbackMs = DEFAULT_TIMEOUT_MS) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function formatBodyPreview(body) {
  if (body.length <= RESPONSE_PREVIEW_LIMIT) {
    return body;
  }
  return `${body.slice(0, RESPONSE_PREVIEW_LIMIT)}... [truncated]`;
}

function throwWebCronRequestError({ error, path, timeoutMs }) {
  if (error instanceof Error && /abort|timeout/i.test(error.name)) {
    throw new Error(`Web cron ${path} timed out after ${timeoutMs}ms`);
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Web cron ${path} request failed: ${message}`);
}

function getWebCronConfig(path) {
  const webCronConfig = WEB_CRON_CONFIG.get(path);
  if (!webCronConfig) {
    throw new Error(`Unsupported web cron path: ${path || '(empty)'}`);
  }
  return webCronConfig;
}

function buildWebCronRequest({ baseUrl, path }) {
  if (!baseUrl) {
    throw new Error('BACI_WEB_BASE_URL is required');
  }
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//')
  ) {
    throw new Error('Web cron path must be a root-relative path');
  }

  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (base.protocol !== 'https:') {
    throw new Error('BACI_WEB_BASE_URL must use https');
  }
  if (base.username || base.password) {
    throw new Error('BACI_WEB_BASE_URL must not contain credentials');
  }
  const url = new URL(path, base);
  if (url.origin !== base.origin) {
    throw new Error('Web cron path must resolve within BACI_WEB_BASE_URL');
  }
  const webCronConfig = getWebCronConfig(url.pathname);

  return { url: url.toString(), webCronConfig };
}

export function buildWebCronUrl({ baseUrl, path }) {
  return buildWebCronRequest({ baseUrl, path }).url;
}

export async function runWebCron({
  path,
  env = process.env,
  fetchFn = fetch,
  logger = console,
  allowCacheDeadLetter = false,
}) {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error('CRON_SECRET is required');
  }
  if (typeof fetchFn !== 'function') {
    throw new Error('A fetch implementation is required');
  }

  const { url, webCronConfig } = buildWebCronRequest({
    baseUrl: env.BACI_WEB_BASE_URL,
    path,
  });
  const timeoutMs = readTimeoutMs(
    env.BACI_WEB_CRON_TIMEOUT_MS,
    webCronConfig.timeoutMs
  );
  const headers = {
    Authorization: `Bearer ${cronSecret}`,
    'User-Agent': 'baci-vps-web-cron/1.0',
  };
  let response;
  try {
    response = await fetchFn(url, {
      method: webCronConfig.method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throwWebCronRequestError({ error, path, timeoutMs });
  }
  let body;
  try {
    body = await response.text();
  } catch (error) {
    throwWebCronRequestError({ error, path, timeoutMs });
  }

  if (!response.ok) {
    const preview = formatBodyPreview(body);
    let bodyPayload;
    try {
      bodyPayload = JSON.parse(body);
    } catch {
      bodyPayload = null;
    }
    if (
      allowCacheDeadLetter &&
      new URL(url).pathname === '/api/cron/drain-cache-invalidations' &&
      response.status === 503 &&
      bodyPayload?.code === CACHE_INVALIDATION_DEAD_LETTER_CODE
    ) {
      return { status: response.status, body, cacheDeadLetter: true };
    }
    throw new Error(
      `Web cron ${path} failed with HTTP ${response.status}: ${preview}`
    );
  }

  logger.log(`[run-web-cron] ${path} completed with HTTP ${response.status}`);
  return { status: response.status, body };
}

async function main() {
  config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

  const path = process.argv[2];
  if (!path) {
    console.error('[run-web-cron] Usage: node jobs/run-web-cron.mjs <path>');
    process.exit(1);
  }

  try {
    await runWebCron({ path });
  } catch (error) {
    console.error('[run-web-cron] Worker failed:', error);
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}

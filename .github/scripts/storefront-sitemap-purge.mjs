import { chunkPurgeUrls, purgeCloudflareCache } from './cloudflare-purge-cache.mjs';

const DEFAULT_MAX_SITEMAPS = 32;
const DEFAULT_MAX_URLS = 10_000;
const DEFAULT_PURGE_ATTEMPTS = 4;
const DEFAULT_PURGE_PACE_MS = 250;
const DEFAULT_PURGE_RETRY_DELAY_MS = 1_000;
const DEFAULT_PURGE_MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_XML_CHARACTERS = 5_000_000;
const PURGE_BATCH_SIZE = 100;
const RELEASE_PROBE_PARAM = '__baci_release_probe';
const NON_HTML_EXTENSION =
  /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mp4|pdf|png|svg|txt|webm|webp|woff2?|xml)$/i;
const NON_HTML_PREFIXES = ['/_next', '/api', '/cdn-cgi', '/image', '/images', '/media', '/static'];

function parseBoundedInteger(value, fallback, name, maximum) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

export function readSitemapPurgeConfig(env = process.env) {
  const retryDelayMs = parseBoundedInteger(
    env.STOREFRONT_RELEASE_PURGE_RETRY_DELAY_MS,
    DEFAULT_PURGE_RETRY_DELAY_MS,
    'STOREFRONT_RELEASE_PURGE_RETRY_DELAY_MS',
    60_000
  );
  const maxRetryDelayMs = parseBoundedInteger(
    env.STOREFRONT_RELEASE_PURGE_MAX_RETRY_DELAY_MS,
    DEFAULT_PURGE_MAX_RETRY_DELAY_MS,
    'STOREFRONT_RELEASE_PURGE_MAX_RETRY_DELAY_MS',
    120_000
  );
  if (maxRetryDelayMs < retryDelayMs) {
    throw new Error('STOREFRONT_RELEASE_PURGE_MAX_RETRY_DELAY_MS must be at least the retry delay');
  }
  return {
    maxSitemaps: parseBoundedInteger(
      env.STOREFRONT_RELEASE_MAX_SITEMAPS,
      DEFAULT_MAX_SITEMAPS,
      'STOREFRONT_RELEASE_MAX_SITEMAPS',
      64
    ),
    maxUrls: parseBoundedInteger(
      env.STOREFRONT_RELEASE_MAX_URLS,
      DEFAULT_MAX_URLS,
      'STOREFRONT_RELEASE_MAX_URLS',
      25_000
    ),
    maxRetryDelayMs,
    purgeAttempts: parseBoundedInteger(
      env.STOREFRONT_RELEASE_PURGE_ATTEMPTS,
      DEFAULT_PURGE_ATTEMPTS,
      'STOREFRONT_RELEASE_PURGE_ATTEMPTS',
      8
    ),
    purgePaceMs: parseBoundedInteger(
      env.STOREFRONT_RELEASE_PURGE_PACE_MS,
      DEFAULT_PURGE_PACE_MS,
      'STOREFRONT_RELEASE_PURGE_PACE_MS',
      10_000
    ),
    retryDelayMs,
  };
}

export function buildReleaseProbeUrl(baseUrl, path, requestId) {
  const url = new URL(path, baseUrl);
  url.searchParams.set(RELEASE_PROBE_PARAM, requestId);
  return url.href;
}

function decodeXmlText(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);/g, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

export function extractSitemapLocs(xml, label, maximum) {
  const locations = [];
  for (const match of String(xml).matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const value = decodeXmlText(match[1]).trim();
    if (!value) throw new Error(`Empty <loc> in ${label}`);
    locations.push(value);
    if (locations.length > maximum) {
      throw new Error(`${label} exceeds the ${maximum} URL safety limit`);
    }
  }
  return locations;
}

export function validateCanonicalPurgeUrl(value, baseUrl, kind) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid absolute URL in ${kind}: ${value}`);
  }
  const origin = new URL(baseUrl).origin;
  if (
    url.protocol !== 'https:' ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Unsafe non-canonical ${kind} URL: ${value}`);
  }
  if (kind === 'sitemap') {
    if (!url.pathname.endsWith('.xml')) throw new Error(`Invalid sitemap URL: ${value}`);
  } else if (
    NON_HTML_EXTENSION.test(url.pathname) ||
    NON_HTML_PREFIXES.some(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
    )
  ) {
    throw new Error(`Refusing to purge non-HTML sitemap URL: ${value}`);
  }
  return url.href;
}

async function fetchXml({ fetchImpl, label, timeoutMs, url, userAgent }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/xml,text/xml;q=0.9', 'user-agent': userAgent },
      redirect: 'manual',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/(?:application|text)\/(?:xml|[\w.-]+\+xml)\b/i.test(contentType)) {
      throw new Error(`${label} returned non-XML content: ${contentType || 'missing content-type'}`);
    }
    const xml = await response.text();
    if (xml.length > MAX_XML_CHARACTERS) {
      throw new Error(`${label} exceeds the XML size safety limit`);
    }
    return xml;
  } finally {
    clearTimeout(timeout);
  }
}

function addBoundedUrl(urls, url, maximum) {
  urls.add(url);
  if (urls.size > maximum) throw new Error(`Storefront sitemap exceeds the ${maximum} URL safety limit`);
}

export async function discoverStorefrontPurgeUrls({
  baseUrl,
  canaryUrls = [],
  fetchImpl = fetch,
  maxSitemaps = DEFAULT_MAX_SITEMAPS,
  maxUrls = DEFAULT_MAX_URLS,
  requestId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  userAgent = 'Baci storefront release coherence',
}) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Storefront sitemap purge base URL must be an HTTPS origin');
  }
  if (!requestId) throw new Error('Storefront sitemap purge request id is required');
  const origin = base.origin;
  const rootSitemap = new URL('/sitemap.xml', origin).href;
  const indexXml = await fetchXml({
    fetchImpl,
    label: 'cache-busted root sitemap index',
    timeoutMs,
    url: buildReleaseProbeUrl(origin, rootSitemap, `${requestId}-sitemap-index`),
    userAgent,
  });
  if (!/<sitemapindex\b/i.test(indexXml)) throw new Error('Root sitemap is not a sitemap index');
  const childSitemaps = [
    ...new Set(
      extractSitemapLocs(indexXml, 'root sitemap index', maxSitemaps).map((url) =>
        validateCanonicalPurgeUrl(url, origin, 'sitemap')
      )
    ),
  ];
  if (childSitemaps.length === 0) throw new Error('Root sitemap index has no child sitemaps');

  const urls = new Set([rootSitemap, ...childSitemaps]);
  if (urls.size > maxUrls) throw new Error(`Storefront sitemap exceeds the ${maxUrls} URL safety limit`);
  for (const canary of canaryUrls) {
    addBoundedUrl(urls, validateCanonicalPurgeUrl(canary, origin, 'page'), maxUrls);
  }
  for (const [index, sitemap] of childSitemaps.entries()) {
    const xml = await fetchXml({
      fetchImpl,
      label: `cache-busted child sitemap ${sitemap}`,
      timeoutMs,
      url: buildReleaseProbeUrl(origin, sitemap, `${requestId}-sitemap-${index + 1}`),
      userAgent,
    });
    if (!/<urlset\b/i.test(xml)) throw new Error(`Child sitemap is not a URL set: ${sitemap}`);
    for (const location of extractSitemapLocs(xml, sitemap, maxUrls)) {
      addBoundedUrl(urls, validateCanonicalPurgeUrl(location, origin, 'page'), maxUrls);
    }
  }
  return [...urls];
}

function getErrorStatus(error) {
  if (Number.isInteger(error?.status)) return error.status;
  const match = String(error?.message || error).match(/\bHTTP (\d{3})\b/);
  return match ? Number(match[1]) : undefined;
}

export function isRetryablePurgeError(error) {
  const status = getErrorStatus(error);
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  return /fetch failed|ECONNRESET|ETIMEDOUT|socket (?:closed|hang up)/i.test(
    String(error?.message || error)
  );
}

export function retryDelay(error, attempt, baseDelayMs, maximumDelayMs) {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const retryAfter = Number(error?.retryAfterMs) || 0;
  return Math.min(maximumDelayMs, Math.max(exponential, retryAfter));
}

export async function purgeStorefrontUrls({
  attempts = DEFAULT_PURGE_ATTEMPTS,
  cloudflareFetchJson,
  logger = console,
  maxRetryDelayMs = DEFAULT_PURGE_MAX_RETRY_DELAY_MS,
  paceMs = DEFAULT_PURGE_PACE_MS,
  purgeImpl = purgeCloudflareCache,
  retryDelayMs = DEFAULT_PURGE_RETRY_DELAY_MS,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  token,
  urls,
  zoneId,
}) {
  const uniqueUrls = [...new Set(urls)];
  const batches = chunkPurgeUrls(uniqueUrls, PURGE_BATCH_SIZE);
  for (const [batchIndex, batch] of batches.entries()) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await purgeImpl({
          fetchJson: cloudflareFetchJson,
          logger,
          token,
          urls: batch,
          zoneId,
        });
        if (!result || result.skipped) {
          throw new Error(`Cloudflare URL purge was skipped: ${result?.reason || 'unknown'}`);
        }
        break;
      } catch (error) {
        if (attempt === attempts || !isRetryablePurgeError(error)) throw error;
        const delayMs = retryDelay(error, attempt, retryDelayMs, maxRetryDelayMs);
        logger.warn(`Cloudflare purge batch ${batchIndex + 1} attempt ${attempt} failed; retrying.`);
        await sleep(delayMs);
      }
    }
    if (batchIndex < batches.length - 1 && paceMs > 0) await sleep(paceMs);
  }
  return { batchCount: batches.length, purgedUrls: uniqueUrls, skipped: false, zoneId };
}

export async function purgeSitemapBackedHtml(options) {
  const config = readSitemapPurgeConfig(options.env);
  const urls = await discoverStorefrontPurgeUrls({
    ...options,
    maxSitemaps: options.maxSitemaps ?? config.maxSitemaps,
    maxUrls: options.maxUrls ?? config.maxUrls,
  });
  options.logger?.log(`Discovered ${urls.length} sitemap-backed storefront HTML URLs.`);
  const result = await purgeStorefrontUrls({
    ...options,
    attempts: options.attempts ?? config.purgeAttempts,
    maxRetryDelayMs: options.maxRetryDelayMs ?? config.maxRetryDelayMs,
    paceMs: options.paceMs ?? config.purgePaceMs,
    retryDelayMs: options.retryDelayMs ?? config.retryDelayMs,
    urls,
  });
  return { ...result, urls };
}

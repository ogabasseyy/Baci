/**
 * Cloudflare Worker: Storefront Search Autocomplete
 *
 * Moves `/api/search/autocomplete` completely off Vercel Fluid Compute onto
 * Cloudflare's edge with built-in Cache API (`caches.default`) caching,
 * per-isolate in-flight request coalescing, and a bounded concurrency cap.
 * Uses ONLY the public Supabase anon key under RLS (never service-role).
 *
 * Note on Cloudflare Cache API: `caches.default` is per-datacenter (colo)
 * and does not replicate across colos. Per-key in-flight coalescing and
 * `MAX_IN_FLIGHT` protect Supabase from bursty concurrent cache misses
 * within an isolate.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Exact parity with `SEARCH_QUERY_SANITIZATION_REGEX` in apps/web/src/lib/sanitize-core.ts
const SEARCH_QUERY_SANITIZATION_REGEX = /[<>'"`;\\,()|]/g;
const MAX_QUERY_LENGTH = 200;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const EDGE_CACHE_TTL_SECONDS = 120;
const EDGE_CACHE_SWR_SECONDS = 600;
const UPSTREAM_TIMEOUT_MS = 5000;
export const MAX_IN_FLIGHT = 256;

/** @type {Map<string, Promise<{ suggestions: unknown[], popularSearches: unknown[] }>>} */
const inFlightRequests = new Map();

/**
 * Exact parity with `sanitizeSearchQuery` in apps/web/src/lib/sanitize-core.ts.
 * Preserves internal whitespace because exact/fuzzy SKU ranking and cache
 * identity depend on it (see storefront-search-autocomplete.ts).
 */
export function sanitizeQuery(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(SEARCH_QUERY_SANITIZATION_REGEX, '')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

/**
 * Exact parity with `isSafeUrl` in apps/web/src/lib/product-image.ts.
 * Allows relative paths (excluding protocol-relative `//...`) and http/https URLs.
 */
export function isSafeProductImageUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  if (url.startsWith('//')) return false;
  if (url.startsWith('/')) return true;
  try {
    const parsed = new URL(url, 'https://placeholder.invalid');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getPrimaryImage(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  for (const item of images) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed && isSafeProductImageUrl(trimmed)) return trimmed;
    } else if (
      item &&
      typeof item === 'object' &&
      typeof item.url === 'string'
    ) {
      const trimmed = item.url.trim();
      if (trimmed && isSafeProductImageUrl(trimmed)) return trimmed;
    }
  }
  return null;
}

export function isOriginAllowed(origin, allowedOriginsEnv) {
  const configured = (allowedOriginsEnv ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  // Fail closed when no allowlist is configured so arbitrary third-party
  // origins cannot use this worker as an open cross-origin backend.
  if (configured.length === 0) {
    return false;
  }

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  const originLower = parsedOrigin.origin.toLowerCase();
  const hostnameLower = parsedOrigin.hostname.toLowerCase();

  return configured.some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1);
      return (
        hostnameLower.endsWith(suffix) && hostnameLower.length > suffix.length
      );
    }
    return originLower === entry;
  });
}

export function buildCorsHeaders(request, env = {}) {
  const origin = request.headers.get('Origin');
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });

  if (origin && isOriginAllowed(origin, env.ALLOWED_ORIGINS)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return headers;
}

function jsonResponse(body, status, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  return new Response(JSON.stringify(body), { status, headers });
}

function withCors(response, corsHeaders) {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders.entries()) {
    if (key.toLowerCase() === 'vary') {
      const existing = headers.get('Vary');
      if (!existing) {
        headers.set('Vary', value);
      } else if (
        !existing
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .includes(value.toLowerCase())
      ) {
        headers.set('Vary', `${existing}, ${value}`);
      }
      continue;
    }
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

function extractProductIds(rows) {
  if (!Array.isArray(rows)) return [];
  const ids = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = row.product_id ?? row.id;
    if (typeof id === 'string' && UUID_PATTERN.test(id)) {
      ids.push(id);
    }
  }
  return ids;
}

async function queryAutocomplete({
  supabaseUrl,
  anonKey,
  merchantId,
  query,
  limit,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const baseHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
  };

  try {
    const rpcRes = await fetch(
      `${supabaseUrl}/rest/v1/rpc/search_products_v2`,
      {
        method: 'POST',
        headers: baseHeaders,
        signal: controller.signal,
        body: JSON.stringify({
          brand_filter: null,
          category_id_filter: null,
          condition_filter: null,
          max_price_filter: null,
          merchant_id_param: merchantId,
          min_price_filter: null,
          min_rating_filter: null,
          parent_only: false,
          result_limit: limit,
          result_offset: 0,
          search_query: query,
          sort_by: 'relevance',
          status_filter: 'active',
          stock_filter: null,
        }),
      }
    );

    if (!rpcRes.ok) {
      throw new Error(`RPC search_products_v2 failed: ${rpcRes.status}`);
    }

    const rankedIds = extractProductIds(await rpcRes.json());
    if (rankedIds.length === 0) {
      return { suggestions: [], popularSearches: [] };
    }

    const params = new URLSearchParams({
      select: 'id,name,category,price,images,slug',
      merchant_id: `eq.${merchantId}`,
      status: 'eq.active',
      id: `in.(${rankedIds.join(',')})`,
    });

    const prodRes = await fetch(
      `${supabaseUrl}/rest/v1/products?${params.toString()}`,
      {
        method: 'GET',
        headers: baseHeaders,
        signal: controller.signal,
      }
    );

    if (!prodRes.ok) {
      throw new Error(`Products lookup failed: ${prodRes.status}`);
    }

    const rows = await prodRes.json();
    const order = new Map(rankedIds.map((id, idx) => [id, idx]));
    const suggestions = (Array.isArray(rows) ? rows : [])
      .map((product) => ({
        id: product.id,
        name: product.name,
        category: product.category ?? null,
        price: product.price ?? null,
        image_small: getPrimaryImage(product.images),
        slug: product.slug ?? null,
        relevance: 1,
      }))
      .sort(
        (a, b) =>
          (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      );

    return { suggestions, popularSearches: [] };
  } finally {
    clearTimeout(timer);
  }
}

export function runBoundedCoalescedQuery(
  coalesceKey,
  work,
  maxInFlight = MAX_IN_FLIGHT
) {
  const existing = inFlightRequests.get(coalesceKey);
  if (existing) {
    return existing;
  }

  if (inFlightRequests.size >= maxInFlight) {
    const error = new Error('Autocomplete request capacity exceeded');
    error.code = 'autocomplete_saturated';
    return Promise.reject(error);
  }

  const pending = Promise.resolve()
    .then(work)
    .finally(() => {
      if (inFlightRequests.get(coalesceKey) === pending) {
        inFlightRequests.delete(coalesceKey);
      }
    });

  inFlightRequests.set(coalesceKey, pending);
  return pending;
}

export default {
  async fetch(request, env = {}, ctx = undefined) {
    const url = new URL(request.url);
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === '/healthz') {
      return withCors(
        jsonResponse({ ok: true, service: 'baci-autocomplete-proxy' }, 200, {
          'Cache-Control': 'no-store',
        }),
        corsHeaders
      );
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return withCors(
        jsonResponse({ error: 'Method not allowed' }, 405, {
          Allow: 'GET, HEAD, OPTIONS',
          'Cache-Control': 'no-store',
        }),
        corsHeaders
      );
    }

    const rawQ = url.searchParams.get('q') ?? '';
    const merchantId = (url.searchParams.get('merchant_id') ?? '').trim();
    const rawLimit = url.searchParams.get('limit');
    const parsedLimit =
      rawLimit === null || rawLimit === '' ? DEFAULT_LIMIT : Number(rawLimit);

    if (!rawQ.trim() || !merchantId) {
      return withCors(
        jsonResponse({ error: 'Missing query or merchant_id parameter' }, 400, {
          'Cache-Control': 'no-store',
        }),
        corsHeaders
      );
    }

    if (!UUID_PATTERN.test(merchantId)) {
      return withCors(
        jsonResponse({ error: 'Invalid merchant_id format' }, 400, {
          'Cache-Control': 'no-store',
        }),
        corsHeaders
      );
    }

    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > MAX_LIMIT
    ) {
      return withCors(
        jsonResponse({ error: 'Invalid autocomplete parameters' }, 400, {
          'Cache-Control': 'no-store',
        }),
        corsHeaders
      );
    }

    const query = sanitizeQuery(rawQ);
    if (query.length < 2) {
      return withCors(
        jsonResponse({ suggestions: [], popularSearches: [] }, 200, {
          'Cache-Control': 'public, max-age=60',
        }),
        corsHeaders
      );
    }

    const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
    const anonKey = env.SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !anonKey) {
      return withCors(
        jsonResponse({ error: 'Autocomplete worker not configured' }, 503, {
          'Cache-Control': 'no-store',
        }),
        corsHeaders
      );
    }

    const normalizedCacheUrl = new URL(url.origin);
    normalizedCacheUrl.pathname = '/autocomplete';
    normalizedCacheUrl.searchParams.set(
      'merchant_id',
      merchantId.toLowerCase()
    );
    normalizedCacheUrl.searchParams.set('q', query.toLowerCase());
    normalizedCacheUrl.searchParams.set('limit', String(parsedLimit));
    const coalesceKey = normalizedCacheUrl.search;
    const cacheKey = new Request(normalizedCacheUrl.toString(), {
      method: 'GET',
    });
    const edgeCache =
      typeof caches !== 'undefined' && caches.default ? caches.default : null;

    if (edgeCache) {
      const cached = await edgeCache.match(cacheKey);
      if (cached) {
        return withCors(cached, corsHeaders);
      }
    }

    const parsedMaxInFlight = Number(env.MAX_IN_FLIGHT);
    const maxInFlight =
      Number.isInteger(parsedMaxInFlight) && parsedMaxInFlight > 0
        ? parsedMaxInFlight
        : MAX_IN_FLIGHT;

    try {
      const result = await runBoundedCoalescedQuery(
        coalesceKey,
        () =>
          queryAutocomplete({
            supabaseUrl,
            anonKey,
            merchantId,
            query,
            limit: parsedLimit,
          }),
        maxInFlight
      );

      const response = jsonResponse(result, 200, {
        'Cache-Control': `public, max-age=${EDGE_CACHE_TTL_SECONDS}, stale-while-revalidate=${EDGE_CACHE_SWR_SECONDS}`,
      });

      if (edgeCache) {
        const putPromise = edgeCache.put(cacheKey, response.clone());
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(putPromise);
        } else {
          await putPromise;
        }
      }

      return withCors(response, corsHeaders);
    } catch (error) {
      if (error && error.code === 'autocomplete_saturated') {
        return withCors(
          jsonResponse({ suggestions: [], popularSearches: [] }, 200, {
            'Cache-Control': 'no-store',
            'X-Autocomplete-Degraded': 'autocomplete_saturated',
          }),
          corsHeaders
        );
      }

      return withCors(
        jsonResponse({ error: 'Failed to get autocomplete suggestions' }, 500, {
          'Cache-Control': 'no-store',
        }),
        corsHeaders
      );
    }
  },
};

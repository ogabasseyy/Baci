/**
 * Cloudflare Worker: Storefront Search Autocomplete
 *
 * Moves `/api/search/autocomplete` completely off Vercel Fluid Compute onto
 * Cloudflare's edge with built-in Cache API (`caches.default`) caching.
 * Uses ONLY the public Supabase anon key under RLS (never service-role).
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const EDGE_CACHE_TTL_SECONDS = 120;
const EDGE_CACHE_SWR_SECONDS = 600;
const UPSTREAM_TIMEOUT_MS = 5000;

export function sanitizeQuery(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function getPrimaryImage(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  for (const item of images) {
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (item && typeof item === 'object' && typeof item.url === 'string') {
      const trimmed = item.url.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

export function isOriginAllowed(origin, allowedOriginsEnv) {
  const configured = (allowedOriginsEnv ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (configured.length === 0) {
    return true;
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

  if (origin) {
    if (isOriginAllowed(origin, env.ALLOWED_ORIGINS)) {
      headers.set('Access-Control-Allow-Origin', origin);
    }
  } else if (!env.ALLOWED_ORIGINS?.trim()) {
    headers.set('Access-Control-Allow-Origin', '*');
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

    try {
      const result = await queryAutocomplete({
        supabaseUrl,
        anonKey,
        merchantId,
        query,
        limit: parsedLimit,
      });

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
    } catch {
      return withCors(
        jsonResponse({ error: 'Failed to get autocomplete suggestions' }, 500, {
          'Cache-Control': 'no-store',
        }),
        corsHeaders
      );
    }
  },
};

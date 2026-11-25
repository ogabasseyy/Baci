/**
 * Cloudflare Worker: PostHog Reverse Proxy
 *
 * Offloads `/baci-relay/*` traffic from Vercel CDN/Middleware to Cloudflare's
 * edge. Routes `/static/*` and `/array/*` to PostHog's assets host and all
 * other paths (`/i/v0/e/`, `/e/`, `/flags/`, `/decide/`, etc.) to PostHog's
 * ingest host.
 */

export const DEFAULT_INGEST_HOST = 'https://eu.i.posthog.com';
export const DEFAULT_ASSETS_HOST = 'https://eu-assets.i.posthog.com';

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'OPTIONS']);
const STRIPPED_REQUEST_HEADERS = new Set([
  'authorization',
  'connection',
  'cookie',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-csrf-token',
  'x-forwarded-host',
  'x-supabase-auth-token',
]);

function normalizeOrigin(value, fallback) {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed || fallback;
}

function normalizeProxyPrefix(value) {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, '');
}

export function stripProxyPrefix(pathname, prefix) {
  const normalizedPrefix = normalizeProxyPrefix(prefix);
  if (!normalizedPrefix) return pathname;
  if (pathname === normalizedPrefix) return '/';
  if (pathname.startsWith(`${normalizedPrefix}/`)) {
    return pathname.slice(normalizedPrefix.length) || '/';
  }
  return pathname;
}

export function isAssetsPath(pathname) {
  return (
    pathname === '/static' ||
    pathname.startsWith('/static/') ||
    pathname === '/array' ||
    pathname.startsWith('/array/')
  );
}

export function resolveUpstreamOrigin(pathname, env = {}) {
  return isAssetsPath(pathname)
    ? normalizeOrigin(env.POSTHOG_ASSETS_HOST, DEFAULT_ASSETS_HOST)
    : normalizeOrigin(env.POSTHOG_INGEST_HOST, DEFAULT_INGEST_HOST);
}

function isOriginAllowed(origin, allowedOriginsRaw) {
  if (!allowedOriginsRaw?.trim()) return true;
  if (!origin) return false;

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const entries = allowedOriginsRaw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const originLower = origin.toLowerCase();
  const hostname = originUrl.hostname.toLowerCase();

  return entries.some((entry) => {
    if (entry === '*') return true;
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1); // ".usebaci.com"
      return hostname.endsWith(suffix) && hostname.length > suffix.length;
    }
    return originLower === entry;
  });
}

export function buildCorsHeaders(request, env = {}) {
  const origin = request.headers.get('Origin');
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });

  if (origin) {
    if (isOriginAllowed(origin, env.ALLOWED_ORIGINS)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Credentials', 'true');
    }
  } else if (!env.ALLOWED_ORIGINS?.trim()) {
    headers.set('Access-Control-Allow-Origin', '*');
  }

  return headers;
}

function buildUpstreamHeaders(request) {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    if (STRIPPED_REQUEST_HEADERS.has(lower) || lower.startsWith('cf-')) {
      continue;
    }
    headers.set(key, value);
  }

  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp && !headers.has('x-forwarded-for')) {
    headers.set('x-forwarded-for', clientIp);
  }

  return headers;
}

function applyCorsHeaders(responseHeaders, corsHeaders) {
  responseHeaders.delete('access-control-allow-origin');
  responseHeaders.delete('access-control-allow-credentials');
  responseHeaders.delete('access-control-allow-methods');
  responseHeaders.delete('access-control-allow-headers');
  responseHeaders.delete('access-control-max-age');

  for (const [key, value] of corsHeaders.entries()) {
    if (key.toLowerCase() === 'vary') {
      const existing = responseHeaders.get('Vary');
      if (!existing) {
        responseHeaders.set('Vary', value);
      } else if (
        !existing
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .includes(value.toLowerCase())
      ) {
        responseHeaders.set('Vary', `${existing}, ${value}`);
      }
      continue;
    }
    responseHeaders.set(key, value);
  }
}

export default {
  async fetch(request, env = {}) {
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!ALLOWED_METHODS.has(request.method)) {
      const headers = new Headers(corsHeaders);
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers,
      });
    }

    const url = new URL(request.url);
    const upstreamPathname = stripProxyPrefix(
      url.pathname,
      env.POSTHOG_PROXY_PATH
    );

    if (request.method === 'GET' && upstreamPathname === '/healthz') {
      const headers = new Headers(corsHeaders);
      headers.set('Content-Type', 'application/json');
      headers.set('Cache-Control', 'no-store');
      return new Response(
        JSON.stringify({ ok: true, service: 'baci-posthog-proxy' }),
        { status: 200, headers }
      );
    }

    const upstreamOrigin = resolveUpstreamOrigin(upstreamPathname, env);
    const upstreamUrl = `${upstreamOrigin}${upstreamPathname}${url.search}`;

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers: buildUpstreamHeaders(request),
        body:
          request.method === 'GET' || request.method === 'HEAD'
            ? undefined
            : request.body,
        redirect: 'manual',
      });

      const responseHeaders = new Headers(upstreamResponse.headers);
      applyCorsHeaders(responseHeaders, corsHeaders);

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    } catch {
      const headers = new Headers(corsHeaders);
      headers.set('Content-Type', 'application/json');
      return new Response(
        JSON.stringify({ error: 'Upstream request failed' }),
        { status: 502, headers }
      );
    }
  },
};

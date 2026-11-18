const executionOrigin = 'https://baci-builder-output.ogabassey-ai.workers.dev';
const origin = 'https://builder-output-origin.usebaci.com';
const privatePath =
  /^\/resource\/[a-f0-9]{64}\/(index\.html|app\.(?:js|css)|assets\/[a-z0-9-]{1,80})$/;
const publishedPath =
  /^\/published\/[a-z0-9][a-z0-9-]{0,99}\/[a-f0-9]{64}\/(index\.html|app\.(?:js|css)|assets\/[a-z0-9-]{1,80})$/;

const deliveryHeaders = [
  'access-control-allow-origin',
  'content-security-policy',
  'content-type',
  'cross-origin-resource-policy',
  'permissions-policy',
  'referrer-policy',
  'vary',
  'x-baci-output-digest',
  'x-content-type-options',
  'x-robots-tag',
];

function unavailable(status) {
  return new Response(null, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

function isDeliveryPath(url) {
  if (privatePath.test(url.pathname)) return !url.search;
  const match = publishedPath.exec(url.pathname);
  if (!match) return false;
  if (!url.search) return true;
  if (match[1] !== 'index.html' || url.searchParams.size !== 1) return false;
  const path = url.searchParams.get('path');
  if (!path || path.length > 1024 || !path.startsWith('/')) return false;
  return (
    path === '/' ||
    path
      .slice(1)
      .split('/')
      .every((segment) => /^[A-Za-z0-9_[\]-]+$/.test(segment))
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      request.method !== 'GET' ||
      url.origin !== executionOrigin ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname.length + url.search.length > 4096 ||
      !isDeliveryPath(url)
    ) {
      return unavailable(404);
    }
    const isPrivate = privatePath.test(url.pathname);
    const browserOrigin = request.headers.get('Origin');
    // Private assets are read by the opaque sandbox. Document navigation
    // has no Origin header and remains subject to the delivery CSP.
    if (isPrivate && browserOrigin !== null && browserOrigin !== 'null')
      return unavailable(404);
    if (
      typeof env.EXECUTION_ORIGIN_KEY !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(env.EXECUTION_ORIGIN_KEY)
    ) {
      return unavailable(503);
    }
    try {
      const upstream = new URL(origin);
      upstream.pathname = url.pathname;
      upstream.search = url.search;
      const headers = new Headers({
        'X-Baci-Execution-Origin-Key': env.EXECUTION_ORIGIN_KEY,
      });
      if (isPrivate && browserOrigin === 'null') headers.set('Origin', 'null');
      const response = await fetch(upstream, {
        method: 'GET',
        headers,
        cache: 'no-store',
        redirect: 'manual',
        signal: request.signal,
      });
      if (response.status !== 200 && response.status !== 404) {
        await response.body?.cancel();
        return unavailable(response.status === 503 ? 503 : 502);
      }
      const output = new Headers({ 'Cache-Control': 'private, no-store' });
      for (const name of deliveryHeaders) {
        const value = response.headers.get(name);
        if (name === 'access-control-allow-origin' && isPrivate) {
          if (browserOrigin !== 'null' || value !== 'null') continue;
        }
        if (value !== null) output.set(name, value);
      }
      return new Response(response.body, {
        status: response.status,
        headers: output,
      });
    } catch {
      return unavailable(502);
    }
  },
};

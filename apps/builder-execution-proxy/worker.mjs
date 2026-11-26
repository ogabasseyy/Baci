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

// Match the decoded Caddy budget before forwarding the canonical query.
function deliveryQuery(url) {
  if (privatePath.test(url.pathname)) return url.search ? null : '';
  const match = publishedPath.exec(url.pathname);
  if (!match) return null;
  if (!url.search) return '';
  if (match[1] !== 'index.html' || url.searchParams.size !== 1) return null;
  const path = url.searchParams.get('path');
  if (!path || path.length > 1024 || !path.startsWith('/')) return null;
  return path === '/' ||
    path
      .slice(1)
      .split('/')
      .every((segment) => /^[A-Za-z0-9_[\]-]+$/.test(segment))
    ? `?path=${encodeURIComponent(path)}`
    : null;
}

function hasDocumentSandbox(response) {
  const contentType = response.headers.get('content-type')?.split(';')[0];
  const policy = response.headers.get('content-security-policy');
  if (
    contentType?.trim().toLowerCase() !== 'text/html' ||
    !policy ||
    policy.includes(',')
  )
    return false;
  const sandbox = policy
    .split(';')
    .map((directive) => directive.trim().toLowerCase().split(/\s+/))
    .filter(([directive]) => directive === 'sandbox');
  return (
    sandbox.length === 1 &&
    sandbox[0].length === 2 &&
    sandbox[0][1] === 'allow-scripts'
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
      // Inbound HTTP has no fragment, but a synthetic Request can carry one.
      url.hash ||
      url.pathname.length + url.search.length > 4096
    ) {
      return unavailable(404);
    }
    const query = deliveryQuery(url);
    if (query === null || url.pathname.length + query.length > 4096)
      return unavailable(404);
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
      upstream.search = query;
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
      if (response.status !== 200) {
        await response.body?.cancel();
        if (response.status === 404) return unavailable(404);
        if (response.status === 429 || response.status === 503)
          return unavailable(503);
        return unavailable(502);
      }
      if (
        url.pathname.endsWith('/index.html') &&
        !hasDocumentSandbox(response)
      ) {
        await response.body?.cancel();
        return unavailable(502);
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

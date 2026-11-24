import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import worker, {
  DEFAULT_ASSETS_HOST,
  DEFAULT_INGEST_HOST,
  isAssetsPath,
  resolveUpstreamOrigin,
  stripProxyPrefix,
} from './index.mjs';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('cloudflare-posthog-proxy helpers', () => {
  it('routes /static/* and /array/* to assets host and everything else to ingest host', () => {
    assert.equal(isAssetsPath('/static/array.js'), true);
    assert.equal(isAssetsPath('/array/phc_123/config.js'), true);
    assert.equal(isAssetsPath('/i/v0/e/'), false);
    assert.equal(isAssetsPath('/e/'), false);

    assert.equal(
      resolveUpstreamOrigin('/static/array.js'),
      DEFAULT_ASSETS_HOST
    );
    assert.equal(resolveUpstreamOrigin('/i/v0/e/'), DEFAULT_INGEST_HOST);
    assert.equal(
      resolveUpstreamOrigin('/static/array.js', {
        POSTHOG_ASSETS_HOST: 'https://assets.example.com/',
      }),
      'https://assets.example.com'
    );
  });

  it('strips optional proxy prefix when configured', () => {
    assert.equal(stripProxyPrefix('/i/v0/e/', undefined), '/i/v0/e/');
    assert.equal(
      stripProxyPrefix('/baci-relay/i/v0/e/', '/baci-relay'),
      '/i/v0/e/'
    );
    assert.equal(stripProxyPrefix('/baci-relay', 'baci-relay/'), '/');
    assert.equal(stripProxyPrefix('/other/path', '/baci-relay'), '/other/path');
  });
});

describe('cloudflare-posthog-proxy fetch handler', () => {
  it('handles CORS preflight OPTIONS requests', async () => {
    const req = new Request('https://posthog-proxy.usebaci.com/i/v0/e/', {
      method: 'OPTIONS',
      headers: { Origin: 'https://ogabassey.usebaci.com' },
    });

    const res = await worker.fetch(req, {});
    assert.equal(res.status, 204);
    assert.equal(
      res.headers.get('Access-Control-Allow-Origin'),
      'https://ogabassey.usebaci.com'
    );
    assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
  });

  it('serves /healthz without calling upstream', async () => {
    let called = false;
    globalThis.fetch = () => {
      called = true;
      return Promise.resolve(new Response('ok'));
    };

    const req = new Request('https://posthog-proxy.usebaci.com/healthz');
    const res = await worker.fetch(req, {});
    assert.equal(res.status, 200);
    assert.equal(called, false);
    const json = await res.json();
    assert.deepEqual(json, { ok: true, service: 'baci-posthog-proxy' });
  });

  it('rejects unsupported HTTP methods with 405', async () => {
    const req = new Request('https://posthog-proxy.usebaci.com/i/v0/e/', {
      method: 'DELETE',
    });
    const res = await worker.fetch(req, {});
    assert.equal(res.status, 405);
  });

  it('proxies ingest POST requests, strips cookies, forwards cf-connecting-ip, and sets CORS', async () => {
    let capturedUrl = '';
    let capturedInit;
    globalThis.fetch = (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ status: 1 }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        })
      );
    };

    const req = new Request(
      'https://posthog-proxy.usebaci.com/i/v0/e/?ip=1&_=123',
      {
        method: 'POST',
        headers: {
          Origin: 'https://usebaci.com',
          Cookie: 'session=secret',
          'Content-Type': 'application/json',
          'cf-connecting-ip': '203.0.113.42',
          'cf-ray': 'abc123',
        },
        body: JSON.stringify({ event: '$pageview' }),
      }
    );

    const res = await worker.fetch(req, {});
    assert.equal(res.status, 200);
    assert.equal(capturedUrl, 'https://eu.i.posthog.com/i/v0/e/?ip=1&_=123');
    assert.equal(capturedInit.method, 'POST');
    assert.equal(capturedInit.headers.get('cookie'), null);
    assert.equal(capturedInit.headers.get('cf-ray'), null);
    assert.equal(capturedInit.headers.get('x-forwarded-for'), '203.0.113.42');
    assert.equal(
      res.headers.get('Access-Control-Allow-Origin'),
      'https://usebaci.com'
    );
  });

  it('proxies /static/* requests to the assets host', async () => {
    let capturedUrl = '';
    globalThis.fetch = (url) => {
      capturedUrl = url;
      return Promise.resolve(
        new Response('console.log("ok")', {
          status: 200,
          headers: {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'public, max-age=86400',
          },
        })
      );
    };

    const req = new Request(
      'https://posthog-proxy.usebaci.com/static/array.js',
      { method: 'GET' }
    );
    const res = await worker.fetch(req, {});
    assert.equal(res.status, 200);
    assert.equal(
      capturedUrl,
      'https://eu-assets.i.posthog.com/static/array.js'
    );
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=86400');
  });

  it('enforces ALLOWED_ORIGINS when configured', async () => {
    globalThis.fetch = async () => new Response('ok', { status: 200 });

    const req = new Request('https://posthog-proxy.usebaci.com/i/v0/e/', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com' },
    });
    const res = await worker.fetch(req, {
      ALLOWED_ORIGINS: 'https://usebaci.com,*.usebaci.com',
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);

    const allowedReq = new Request(
      'https://posthog-proxy.usebaci.com/i/v0/e/',
      {
        method: 'OPTIONS',
        headers: { Origin: 'https://ogabassey.usebaci.com' },
      }
    );
    const allowedRes = await worker.fetch(allowedReq, {
      ALLOWED_ORIGINS: 'https://usebaci.com,*.usebaci.com',
    });
    assert.equal(
      allowedRes.headers.get('Access-Control-Allow-Origin'),
      'https://ogabassey.usebaci.com'
    );
  });

  it('returns 502 when upstream fetch throws', async () => {
    globalThis.fetch = () => Promise.reject(new Error('network error'));

    const req = new Request('https://posthog-proxy.usebaci.com/i/v0/e/', {
      method: 'POST',
      body: '{}',
    });
    const res = await worker.fetch(req, {});
    assert.equal(res.status, 502);
    const json = await res.json();
    assert.deepEqual(json, { error: 'Upstream request failed' });
  });
});

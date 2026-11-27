import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import worker, {
  getPrimaryImage,
  isOriginAllowed,
  isSafeProductImageUrl,
  sanitizeQuery,
} from './index.mjs';

const originalFetch = globalThis.fetch;
const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const PROD_1 = '22222222-2222-4222-8222-222222222222';
const PROD_2 = '33333333-3333-4333-8333-333333333333';
const ALLOWED_ORIGINS =
  'https://usebaci.com,*.usebaci.com,https://ogabassey.com,https://www.ogabassey.com';

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('cloudflare-autocomplete-proxy helpers', () => {
  it('matches apps/web sanitizeSearchQuery semantics including internal whitespace and 200-char cap', () => {
    assert.equal(sanitizeQuery('  iPhone <16>  Pro  '), 'iPhone 16  Pro');
    assert.equal(sanitizeQuery('a;'), 'a');
    assert.equal(sanitizeQuery(`'test"\\,(|)\``), 'test');
    const longQuery = 'a'.repeat(250);
    assert.equal(sanitizeQuery(longQuery).length, 200);
  });

  it('validates product image URLs and rejects unsafe schemes and protocol-relative URLs', () => {
    assert.equal(isSafeProductImageUrl('https://cdn.example.com/a.avif'), true);
    assert.equal(isSafeProductImageUrl('/images/product.png'), true);
    assert.equal(isSafeProductImageUrl('//evil.example/x.png'), false);
    assert.equal(isSafeProductImageUrl('javascript:alert(1)'), false);
    assert.equal(isSafeProductImageUrl('data:image/svg+xml,<svg/>'), false);

    assert.equal(
      getPrimaryImage([
        'javascript:alert(1)',
        '//evil.example/x.png',
        'data:text/html,hi',
        { url: 'https://cdn.example.com/safe.avif' },
      ]),
      'https://cdn.example.com/safe.avif'
    );
    assert.equal(getPrimaryImage(['javascript:alert(1)']), null);
    assert.equal(getPrimaryImage([]), null);
  });

  it('fails closed on CORS when ALLOWED_ORIGINS is empty or origin is unlisted', () => {
    assert.equal(isOriginAllowed('https://ogabassey.com', ''), false);
    assert.equal(
      isOriginAllowed('https://evil.example', ALLOWED_ORIGINS),
      false
    );
    assert.equal(
      isOriginAllowed('https://ogabassey.com', ALLOWED_ORIGINS),
      true
    );
    assert.equal(
      isOriginAllowed('https://shop.usebaci.com', ALLOWED_ORIGINS),
      true
    );
  });
});

describe('cloudflare-autocomplete-proxy fetch handler', () => {
  it('serves /healthz without calling upstream', async () => {
    let called = false;
    globalThis.fetch = () => {
      called = true;
      return Promise.resolve(new Response('ok'));
    };

    const res = await worker.fetch(
      new Request(
        'https://baci-autocomplete-proxy.example.workers.dev/healthz'
      ),
      { ALLOWED_ORIGINS }
    );
    assert.equal(res.status, 200);
    assert.equal(called, false);
    assert.deepEqual(await res.json(), {
      ok: true,
      service: 'baci-autocomplete-proxy',
    });
  });

  it('validates merchant_id and query parameters and treats stripped <2-char queries as empty', async () => {
    const missingRes = await worker.fetch(
      new Request(
        'https://baci-autocomplete-proxy.example.workers.dev/?q=iphone'
      ),
      { ALLOWED_ORIGINS }
    );
    assert.equal(missingRes.status, 400);

    const badUuidRes = await worker.fetch(
      new Request(
        'https://baci-autocomplete-proxy.example.workers.dev/?q=iphone&merchant_id=not-uuid'
      ),
      { ALLOWED_ORIGINS }
    );
    assert.equal(badUuidRes.status, 400);

    let called = false;
    globalThis.fetch = () => {
      called = true;
      return Promise.resolve(new Response('[]'));
    };
    const strippedShortRes = await worker.fetch(
      new Request(
        `https://baci-autocomplete-proxy.example.workers.dev/?q=a;&merchant_id=${MERCHANT_ID}`
      ),
      {
        ALLOWED_ORIGINS,
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'anon-key',
      }
    );
    assert.equal(strippedShortRes.status, 200);
    assert.equal(called, false);
    assert.deepEqual(await strippedShortRes.json(), {
      suggestions: [],
      popularSearches: [],
    });
  });

  it('omits Access-Control-Allow-Origin for unlisted origins', async () => {
    const res = await worker.fetch(
      new Request(
        'https://baci-autocomplete-proxy.example.workers.dev/healthz',
        { headers: { Origin: 'https://unlisted.example' } }
      ),
      { ALLOWED_ORIGINS }
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(res.headers.get('Vary'), 'Origin');
  });

  it('returns ranked suggestions from Supabase RPC + products table with cache headers and safe images', async () => {
    const calls = [];
    globalThis.fetch = (url) => {
      calls.push(String(url));
      if (String(url).includes('/rpc/search_products_v2')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([{ product_id: PROD_2 }, { product_id: PROD_1 }]),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: PROD_1,
              name: 'iPhone 15',
              category: 'Smartphones',
              price: 900000,
              images: [
                'javascript:alert(1)',
                'https://cdn.example.com/15.avif',
              ],
              slug: 'iphone-15',
            },
            {
              id: PROD_2,
              name: 'iPhone 16 Pro',
              category: 'Smartphones',
              price: 1500000,
              images: [{ url: 'https://cdn.example.com/16.avif' }],
              slug: 'iphone-16-pro',
            },
          ]),
          { status: 200 }
        )
      );
    };

    const res = await worker.fetch(
      new Request(
        `https://baci-autocomplete-proxy.example.workers.dev/?q=iphone&merchant_id=${MERCHANT_ID}&limit=10`,
        { headers: { Origin: 'https://ogabassey.com' } }
      ),
      {
        ALLOWED_ORIGINS,
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'anon-key',
      }
    );

    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(
      res.headers.get('Access-Control-Allow-Origin'),
      'https://ogabassey.com'
    );
    assert.equal(res.headers.get('Vary'), 'Origin');
    assert.equal(
      res.headers.get('Cache-Control'),
      'public, max-age=120, stale-while-revalidate=600'
    );
    const body = await res.json();
    assert.deepEqual(
      body.suggestions.map((item) => item.id),
      [PROD_2, PROD_1]
    );
    assert.equal(
      body.suggestions[0].image_small,
      'https://cdn.example.com/16.avif'
    );
    assert.equal(
      body.suggestions[1].image_small,
      'https://cdn.example.com/15.avif'
    );
    assert.deepEqual(body.popularSearches, []);
  });

  it('coalesces concurrent misses for the same key and enforces MAX_IN_FLIGHT saturation', async () => {
    let releaseRpc;
    const rpcGate = new Promise((resolve) => {
      releaseRpc = resolve;
    });
    let rpcCalls = 0;

    globalThis.fetch = async (url) => {
      if (String(url).includes('/rpc/search_products_v2')) {
        rpcCalls += 1;
        await rpcGate;
        return new Response(JSON.stringify([{ product_id: PROD_1 }]), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify([
          {
            id: PROD_1,
            name: 'Pixel 9',
            category: 'Smartphones',
            price: 800000,
            images: ['https://cdn.example.com/pixel.avif'],
            slug: 'pixel-9',
          },
        ]),
        { status: 200 }
      );
    };

    const env = {
      ALLOWED_ORIGINS,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      MAX_IN_FLIGHT: '1',
    };

    const p1 = worker.fetch(
      new Request(
        `https://baci-autocomplete-proxy.example.workers.dev/?q=pixel&merchant_id=${MERCHANT_ID}`
      ),
      env
    );
    const p2 = worker.fetch(
      new Request(
        `https://baci-autocomplete-proxy.example.workers.dev/?q=pixel&merchant_id=${MERCHANT_ID}`
      ),
      env
    );

    // Distinct key while MAX_IN_FLIGHT=1 is occupied should degrade immediately
    const saturatedRes = await worker.fetch(
      new Request(
        `https://baci-autocomplete-proxy.example.workers.dev/?q=samsung&merchant_id=${MERCHANT_ID}`
      ),
      env
    );

    assert.equal(saturatedRes.status, 200);
    assert.equal(saturatedRes.headers.get('Cache-Control'), 'no-store');
    assert.equal(
      saturatedRes.headers.get('X-Autocomplete-Degraded'),
      'autocomplete_saturated'
    );
    assert.deepEqual(await saturatedRes.json(), {
      suggestions: [],
      popularSearches: [],
    });

    releaseRpc();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(rpcCalls, 1);
  });
});

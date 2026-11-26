import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import worker, { getPrimaryImage, sanitizeQuery } from './index.mjs';

const originalFetch = globalThis.fetch;
const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const PROD_1 = '22222222-2222-4222-8222-222222222222';
const PROD_2 = '33333333-3333-4333-8333-333333333333';

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('cloudflare-autocomplete-proxy helpers', () => {
  it('sanitizes queries and extracts primary product images', () => {
    assert.equal(sanitizeQuery('  iPhone <16>  Pro  '), 'iPhone 16 Pro');
    assert.equal(
      getPrimaryImage(['https://cdn.example.com/a.avif']),
      'https://cdn.example.com/a.avif'
    );
    assert.equal(
      getPrimaryImage([{ url: 'https://cdn.example.com/b.avif' }]),
      'https://cdn.example.com/b.avif'
    );
    assert.equal(getPrimaryImage([]), null);
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
      {}
    );
    assert.equal(res.status, 200);
    assert.equal(called, false);
    assert.deepEqual(await res.json(), {
      ok: true,
      service: 'baci-autocomplete-proxy',
    });
  });

  it('validates merchant_id and query parameters', async () => {
    const missingRes = await worker.fetch(
      new Request(
        'https://baci-autocomplete-proxy.example.workers.dev/?q=iphone'
      ),
      {}
    );
    assert.equal(missingRes.status, 400);

    const badUuidRes = await worker.fetch(
      new Request(
        'https://baci-autocomplete-proxy.example.workers.dev/?q=iphone&merchant_id=not-uuid'
      ),
      {}
    );
    assert.equal(badUuidRes.status, 400);
  });

  it('returns ranked suggestions from Supabase RPC + products table with cache headers', async () => {
    const calls = [];
    globalThis.fetch = (url) => {
      calls.push(String(url));
      if (String(url).includes('/rpc/search_products_v2')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([{ product_id: PROD_2 }, { product_id: PROD_1 }]),
            {
              status: 200,
            }
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
              images: ['https://cdn.example.com/15.avif'],
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
    assert.deepEqual(body.popularSearches, []);
  });
});

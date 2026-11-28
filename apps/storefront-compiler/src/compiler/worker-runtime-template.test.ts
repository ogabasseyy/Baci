import {
  Miniflare,
  type Request as MiniflareRequest,
  Response as MiniflareResponse,
} from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import { compileStorefrontWorker } from './compile-storefront';

describe('worker-runtime-template', () => {
  it('strips spoofed merchant headers/params, enforces CSP form-action none, and handles editorial/400/404/502 routes', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/search', view: 'search' },
      { path: '/pages/:slug', view: 'editorial' },
    ];
    const compiled = await compileStorefrontWorker(manifest);

    const upstreamUrls: string[] = [];
    let upstreamMode: 'ok' | '403' | 'bad-json' = 'ok';
    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'worker.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-07-01',
      bindings: {},
      outboundService: (req: MiniflareRequest) => {
        upstreamUrls.push(req.url);
        if (upstreamMode === '403') {
          return new MiniflareResponse('Forbidden', { status: 403 });
        }
        if (upstreamMode === 'bad-json') {
          return new MiniflareResponse('<html>not-json</html>', {
            status: 200,
          });
        }
        return new MiniflareResponse(
          JSON.stringify({
            title: 'Home',
            products: [],
            facets: { brands: [], conditions: [], totalMatches: 0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
    });

    try {
      const spoofRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/search?q=phone&merchantId=evil',
        { headers: { 'x-baci-merchant-slug': 'evil-slug' } }
      );
      expect(spoofRes.status).toBe(200);
      expect(spoofRes.headers.get('content-security-policy')).toContain(
        "form-action 'none'"
      );
      expect(await spoofRes.text()).toContain('"merchantSlug":"ogabassey"');
      expect(upstreamUrls).toEqual([
        'https://catalog.baci.internal/v1/search?q=phone',
      ]);

      const editorial = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/pages/warranty-policy'
      );
      expect(editorial.status).toBe(200);

      const badUri = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/pages/%FF'
      );
      expect(badUri.status).toBe(400);

      const notFound = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/undeclared'
      );
      expect(notFound.status).toBe(404);

      upstreamMode = '403';
      const err502 = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(err502.status).toBe(502);

      upstreamMode = 'bad-json';
      const badJson502 = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/'
      );
      expect(badJson502.status).toBe(502);
    } finally {
      await mf.dispose();
    }
  });
});

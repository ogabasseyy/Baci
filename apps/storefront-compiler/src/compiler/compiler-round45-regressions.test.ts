import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { applyVariantStockOverlayToJson } from '../benchmark/outbound-overlay';
import { compileStorefrontWorker } from './compile-storefront';

describe('Round 45 dual productId/productSlug enforcement, navigation.open query forwarding, and stock-overlay availability alias sync', () => {
  it('queries and validates every captured product identifier on /products/:productId/:productSlug', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/products/:productId/:productSlug', view: 'product' },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    const seenUrls: string[] = [];
    const iphone = {
      id: 'prod-99',
      slug: 'iphone-16',
      name: 'iPhone 16',
      categorySlug: 'smartphones',
      brand: 'Apple',
      condition: 'New',
      priceNgn: 1_500_000,
      inStock: true,
      imageUrl: 'https://cdn.usebaci.com/ip16.webp',
      imageAlt: 'iPhone 16',
      variants: [],
    };
    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService(req: { url: string }) {
        seenUrls.push(req.url);
        return Response.json({
          generation: 1,
          availabilityGeneration: 1,
          product: iphone,
        });
      },
    });
    try {
      const okRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/products/prod-99/iphone-16'
      );
      expect(okRes.status).toBe(200);
      expect(seenUrls.at(-1)).toBe(
        'https://catalog.baci.internal/v1/product?productSlug=iphone-16&productId=prod-99'
      );

      // Wrong productId with valid productSlug must 404
      const wrongIdRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/products/wrong-id/iphone-16'
      );
      expect(wrongIdRes.status).toBe(404);

      // Valid productId with wrong productSlug must 404
      const wrongSlugRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/products/prod-99/wrong-slug'
      );
      expect(wrongSlugRes.status).toBe(404);
    } finally {
      await mf.dispose();
    }
  });

  it('updates both inStock and available aliases in applyVariantStockOverlayToJson without triggering 502', async () => {
    const cachedJson = JSON.stringify({
      generation: 1,
      availabilityGeneration: 1,
      product: {
        id: 'p1',
        slug: 'iphone-16',
        name: 'iPhone 16',
        categorySlug: 'smartphones',
        categoryName: 'Smartphones',
        brand: 'Apple',
        condition: 'New',
        priceNgn: 1_500_000,
        inStock: true,
        available: true,
        imageUrl: 'https://cdn.usebaci.com/ip16.webp',
        imageAlt: 'iPhone 16',
        shortSpecs: '128GB',
        variants: [
          {
            id: 'v1',
            label: '128GB',
            storage: '128GB',
            color: 'Black',
            priceNgn: 1_500_000,
            inStock: true,
            available: true,
          },
        ],
      },
    });
    const overlaid = applyVariantStockOverlayToJson(
      cachedJson,
      { v1: false },
      { coupled: 1, availability: 2 }
    );
    const parsed = JSON.parse(overlaid) as {
      product: {
        inStock: boolean;
        available: boolean;
        variants: { inStock: boolean; available: boolean }[];
      };
    };
    expect(parsed.product.inStock).toBe(false);
    expect(parsed.product.available).toBe(false);
    expect(parsed.product.variants[0]?.inStock).toBe(false);
    expect(parsed.product.variants[0]?.available).toBe(false);

    // Verify compiled Worker renders overlaid payload as 200 (not 502)
    const manifest = createOgabasseyStorefrontManifest();
    const compiled = await compileStorefrontWorker(manifest);
    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService() {
        return new Response(overlaid, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    try {
      const res = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/smartphones/iphone-16'
      );
      expect(res.status).toBe(200);
    } finally {
      await mf.dispose();
    }
  });
});

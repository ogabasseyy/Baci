import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { compileStorefrontWorker } from './compile-storefront';

describe('Round 41 :brand/:condition canonical product paths and SSR requiresVariant derivation', () => {
  it('populates :brand and :condition in product canonicalPath and derives requiresVariant in SSR projection', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/brands/:brand/products/:productSlug', view: 'product' },
      { path: '/conditions/:condition/items/:productSlug', view: 'product' },
    ];
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function App(props: {
          view: string;
          products: Array<{ slug: string; requiresVariant?: boolean }>;
          productDetail?: { slug: string; brand: string; requiresVariant?: boolean } | null;
        }) {
          const listSummary = props.products.map((p) => \`\${p.slug}:req=\${String(p.requiresVariant)}\`).join('|');
          const detailSummary = props.productDetail ? \`detail:\${props.productDetail.slug}:req=\${String(props.productDetail.requiresVariant)}\` : 'none';
          return <main data-view={props.view}>{listSummary};{detailSummary}</main>;
        }`,
      },
    ];

    const compiled = await compileStorefrontWorker(manifest);
    const iphone = {
      id: 'prod_iphone16',
      slug: 'iphone-16-pro',
      name: 'iPhone 16 Pro',
      categorySlug: 'smartphones',
      brand: 'Apple',
      condition: 'New',
      priceNgn: 1_850_000,
      inStock: true,
      imageUrl: 'https://cdn.usebaci.com/iphone16pro.webp',
      imageAlt: 'iPhone 16 Pro',
      variants: [
        {
          id: 'var_256',
          label: '256GB Natural Titanium',
          priceNgn: 1_850_000,
          inStock: true,
        },
      ],
    };

    const usedPad = {
      id: 'prod_pad',
      slug: 'ipad-air',
      name: 'iPad Air',
      categorySlug: 'tablets',
      brand: '',
      condition: 'Refurbished',
      priceNgn: 650_000,
      inStock: true,
      imageUrl: 'https://cdn.usebaci.com/ipadair.webp',
      imageAlt: 'iPad Air',
      variants: [],
    };

    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService(req: { url: string }) {
        if (req.url.includes('/v1/product')) {
          return Response.json({
            generation: 1,
            availabilityGeneration: 1,
            product: req.url.includes('ipad-air') ? usedPad : iphone,
          });
        }
        return Response.json({
          generation: 1,
          availabilityGeneration: 1,
          categoryExists: true,
          products: [iphone, usedPad],
          facets: {
            brands: [{ value: 'Apple', count: 1 }],
            conditions: [
              { value: 'New', count: 1 },
              { value: 'Refurbished', count: 1 },
            ],
            totalMatches: 2,
          },
        });
      },
    });

    try {
      // 1. Catalog bridge canonicalPath uses actual brand ('Apple'), NOT categorySlug ('smartphones')
      const catRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=product&handle=iphone-16-pro'
      );
      expect(catRes.status).toBe(200);
      const catJson = (await catRes.json()) as {
        status: string;
        value: { canonicalPath: string; requiresVariant: boolean };
      };
      expect(catJson.value.canonicalPath).toBe(
        '/brands/Apple/products/iphone-16-pro'
      );
      expect(catJson.value.requiresVariant).toBe(true);

      // 2. SSR home projection derives requiresVariant: true when upstream omits requiresVariant & has_variants
      const homeRes = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(homeRes.status).toBe(200);
      const homeHtml = await homeRes.text();
      expect(homeHtml).toContain('iphone-16-pro:req=true');

      // 3. Matching /brands/Apple/products/iphone-16-pro renders 200 with requiresVariant: true, while /brands/Samsung/... returns 404
      const pdpOk = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/brands/Apple/products/iphone-16-pro'
      );
      expect(pdpOk.status).toBe(200);
      expect(await pdpOk.text()).toContain('detail:iphone-16-pro:req=true');

      const pdpWrongBrand = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/brands/Samsung/products/iphone-16-pro'
      );
      expect(pdpWrongBrand.status).toBe(404);

      // 4. Condition fallback canonicalPath + condition match/mismatch 404
      const padCat = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=product&handle=ipad-air'
      );
      const padJson = (await padCat.json()) as {
        value: { canonicalPath: string; requiresVariant: boolean };
      };
      expect(padJson.value.canonicalPath).toBe(
        '/conditions/Refurbished/items/ipad-air'
      );
      expect(padJson.value.requiresVariant).toBe(false);

      const condOk = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/conditions/Refurbished/items/ipad-air'
      );
      expect(condOk.status).toBe(200);
      const condWrong = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/conditions/New/items/ipad-air'
      );
      expect(condWrong.status).toBe(404);
    } finally {
      await mf.dispose();
    }
  });
});

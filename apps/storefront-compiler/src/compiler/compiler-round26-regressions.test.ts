import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 26 compiler & runtime regressions', () => {
  it('blocks UIEvent.view and MessageEvent.source Window escapes across property chains and destructuring', async () => {
    const escapes = [
      `<button type="button" onClick={(e) => { e.nativeEvent.view?.open('https://evil.example'); }}>x</button>`,
      `<button type="button" onClick={(e) => { const v = e.view; (v as any)?.open('https://evil.example'); }}>x</button>`,
      `<button type="button" onClick={({ nativeEvent: { view } }) => { (view as any)?.location.replace('https://evil.example'); }}>x</button>`,
      `<button type="button" onClick={(e) => { const { ['view']: w } = e.nativeEvent; (w as any)?.open('https://evil.example'); }}>x</button>`,
      `<button type="button" onClick={(e: any) => { e.source?.open('https://evil.example'); }}>x</button>`,
    ];

    for (const jsx of escapes) {
      const manifest = createOgabasseyStorefrontManifest();
      manifest.files = [
        {
          path: 'src/StorefrontApp.tsx',
          content: `export default function StorefrontApp() { return <main>${jsx}</main>; }`,
        },
      ];
      await expect(compileStorefrontWorker(manifest)).rejects.toThrow(
        StorefrontCompilerError
      );
    }
  });

  it('rejects manifest entries lacking a valid default React component at compile time', async () => {
    const invalidEntries = [
      `export function NamedOnly() { return <main>Named</main>; }`,
      `const bad = 42;\nexport default bad;`,
      `let reassigned: any = () => <main>ok</main>;\nreassigned = 42;\nexport default reassigned;`,
      `export default { notAComponent: true };`,
      `export default "hello";`,
    ];

    for (const entryContent of invalidEntries) {
      const manifest = createOgabasseyStorefrontManifest();
      manifest.files = [
        { path: 'src/StorefrontApp.tsx', content: entryContent },
      ];
      await expect(compileStorefrontWorker(manifest)).rejects.toThrow(
        /must export a valid default React component/
      );
    }

    // Non-reassigned let/var component bindings compile cleanly
    for (const validLetVar of [
      `let App = () => <main>let ok</main>;\nexport default App;`,
      `var App = function Store() { return <main>var ok</main>; };\nexport default App;`,
    ]) {
      const m = createOgabasseyStorefrontManifest();
      m.files = [{ path: 'src/StorefrontApp.tsx', content: validLetVar }];
      const res = await compileStorefrontWorker(m);
      expect(res.workerCode.length).toBeGreaterThan(0);
    }
  });

  it('rejects conflicting catalog price aliases (priceNgn !== price) and non-string catalog titles with 502', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    const compiled = await compileStorefrontWorker(manifest);
    let mode:
      | 'conflicting-price'
      | 'conflicting-variant-price'
      | 'object-title'
      | 'valid' = 'conflicting-price';

    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService() {
        return Response.json({
          generation: 1,
          availabilityGeneration: 1,
          title: mode === 'object-title' ? { bad: true } : 'Valid Devices',
          categoryExists: true,
          products: [
            {
              id: 'p1',
              slug: 'iphone-16',
              name: 'iPhone 16',
              categorySlug: 'smartphones',
              brand: 'Apple',
              condition: 'New',
              priceNgn: 1_000_000,
              ...(mode === 'conflicting-price'
                ? { price: 10 }
                : { price: 1_000_000 }),
              inStock: true,
              variants: [
                {
                  id: 'v1',
                  label: '128GB',
                  priceNgn: 1_000_000,
                  ...(mode === 'conflicting-variant-price'
                    ? { price: 25 }
                    : { price: 1_000_000 }),
                  inStock: true,
                },
              ],
            },
          ],
          facets: { brands: [], conditions: [], totalMatches: 1 },
        });
      },
    });

    try {
      const badProdPrice = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/'
      );
      expect(badProdPrice.status).toBe(502);

      const badBridgePrice = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=collection&handle=smartphones'
      );
      expect(badBridgePrice.status).toBe(502);

      mode = 'conflicting-variant-price';
      const badVarPrice = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/'
      );
      expect(badVarPrice.status).toBe(502);

      mode = 'object-title';
      const badTitle = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/'
      );
      expect(badTitle.status).toBe(502);

      mode = 'valid';
      const okRes = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(okRes.status).toBe(200);
      expect(await okRes.text()).toContain('Valid Devices');
    } finally {
      await mf.dispose();
    }
  });
});

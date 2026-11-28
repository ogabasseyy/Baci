import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

async function expectSafetyError(
  content: string,
  expectedSnippet: string
): Promise<void> {
  const m = createOgabasseyStorefrontManifest();
  m.files = [{ path: 'src/StorefrontApp.tsx', content }];
  let caught: unknown = null;
  try {
    await compileStorefrontWorker(m);
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof StorefrontCompilerError)) {
    throw new Error('Expected StorefrontCompilerError');
  }
  expect(caught.code).toBe('SOURCE_SAFETY_VIOLATION');
  expect(caught.message).toContain(expectedSnippet);
}

describe('Round 47 SKU canonicalPath accuracy, named intrinsic handlers, and memo comparator validation', () => {
  it('omits canonicalPath on :sku-only routes when no unambiguous SKU exists instead of substituting product slug', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/products/:sku', view: 'product' },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService(req: { url: string }) {
        const u = new URL(req.url);
        if (u.pathname === '/v1/product') {
          const handle =
            u.searchParams.get('productSlug') ?? u.searchParams.get('handle');
          if (handle === 'multi-sku-phone') {
            return Response.json({
              generation: 1,
              availabilityGeneration: 1,
              product: {
                id: 'prod_multi',
                slug: 'multi-sku-phone',
                name: 'Multi SKU Phone',
                categorySlug: 'smartphones',
                priceNgn: 800_000,
                inStock: true,
                imageUrl: 'https://cdn.usebaci.com/p1.webp',
                imageAlt: 'Phone',
                variants: [
                  {
                    id: 'v1',
                    sku: 'OGA-1-1',
                    label: '128GB',
                    priceNgn: 800_000,
                    inStock: true,
                  },
                  {
                    id: 'v2',
                    sku: 'OGA-1-2',
                    label: '256GB',
                    priceNgn: 900_000,
                    inStock: true,
                  },
                ],
              },
            });
          }
          return Response.json({
            generation: 1,
            availabilityGeneration: 1,
            product: {
              id: 'prod_single',
              slug: 'top-sku-laptop',
              sku: 'MBP-M4-PRO',
              name: 'MacBook Pro',
              categorySlug: 'laptops',
              priceNgn: 2_500_000,
              inStock: true,
              imageUrl: 'https://cdn.usebaci.com/p2.webp',
              imageAlt: 'Laptop',
              variants: [],
            },
          });
        }
        return Response.json({ generation: 1, products: [] });
      },
    });
    try {
      const multiRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=product&handle=multi-sku-phone'
      );
      const multiJson = (await multiRes.json()) as {
        status: string;
        value: { canonicalPath?: string };
      };
      expect(multiJson.status).toBe('ok');
      expect(multiJson.value.canonicalPath).toBeUndefined();

      const explicitRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=product&handle=top-sku-laptop'
      );
      const explicitJson = (await explicitRes.json()) as {
        status: string;
        value: { canonicalPath?: string };
      };
      expect(explicitJson.status).toBe('ok');
      expect(explicitJson.value.canonicalPath).toBe('/products/MBP-M4-PRO');
    } finally {
      await mf.dispose();
    }
  });

  it('permits named intrinsic event handlers and effect callbacks while rejecting handlers also invoked during render', async () => {
    const valid = createOgabasseyStorefrontManifest();
    valid.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `import { useEffect } from 'react';
        function helperReadTitle(): string { return document.title; }
        export default function App() {
          const handleClick = () => { const t = helperReadTitle(); void t; };
          function handleFocus() { const w = window.innerWidth; void w; }
          const syncEffect = () => { const lang = navigator.language; void lang; };
          useEffect(syncEffect, []);
          return <main><button type="button" onClick={handleClick} onFocus={handleFocus}>Inspect</button></main>;
        }`,
      },
    ];
    const compiled = await compileStorefrontWorker(valid);
    expect(compiled.workerCode).toContain('Inspect');

    const unsafeUses = [
      `export default function App() { const handleClick = () => document.title; return <main><p>{handleClick()}</p><button type="button" onClick={handleClick}>Go</button></main>; }`,
      `export default function App(p: { step?: number }) { switch (p.step ?? 1) { case 1: { const read = () => document.title; return <main>{read()}</main>; } default: return <main>ok</main>; } }`,
      `export default function App(p: { step?: number }) { switch (p.step ?? 1) { case 1: const read = () => document.title; return <main>{read()}</main>; default: return <main>ok</main>; } }`,
      `function Custom(p: { onClick: () => string }) { return <p>{p.onClick()}</p>; }\nexport default function App() { const handleClick = () => document.title; return <Custom onClick={handleClick} />; }`,
      `export function handleClick() { return document.title; }\nexport default function App() { return <button type="button" onClick={handleClick}>Go</button>; }`,
    ];
    for (const src of unsafeUses) {
      await expectSafetyError(src, 'Unguarded SSR read of browser global');
    }
  });

  it('rejects non-callable or async memo comparators while permitting valid memo comparators', async () => {
    const invalidComparators = [
      `import { memo } from 'react';\nfunction Base() { return <main>ok</main>; }\nexport default memo(Base, ({} as unknown) as () => boolean);`,
      `import { memo } from 'react';\nfunction Base() { return <main>ok</main>; }\nexport default memo(Base, ('bad' as unknown) as () => boolean);`,
      `import { memo } from 'react';\nfunction Base() { return <main>ok</main>; }\nexport default memo(Base, (async () => true) as unknown as () => boolean);`,
      `import { memo } from 'react';\nfunction Base() { return <main>ok</main>; }\nfunction areEqual() { return true; }\n(areEqual as unknown) = async () => true;\nconst eqAlias = areEqual;\nexport default memo(Base, eqAlias);`,
      `import { memo } from 'react';\nfunction Child() { return <span>c</span>; }\nconst Bad = memo(Child, (123 as unknown) as () => boolean);\nexport default function App() { return <main><Bad /></main>; }`,
    ];
    for (const src of invalidComparators) {
      await expectSafetyError(src, '');
    }

    const validMemo = createOgabasseyStorefrontManifest();
    validMemo.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `import { memo } from 'react';
        interface Props { title: string }
        function Base(p: Props) { return <main>{p.title}</main>; }
        const areEqual = (prev: Props, next: Props) => prev.title === next.title;
        export default memo(Base, areEqual);`,
      },
    ];
    const compiled = await compileStorefrontWorker(validMemo);
    expect(compiled.workerCode).toContain('title');
  });
});

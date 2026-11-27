import {
  Miniflare,
  type Request as MiniflareRequest,
  Response as MiniflareResponse,
} from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import { parseWorkerStorefrontManifest } from '../schemas/worker-manifest';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round-11 Codex execCommand/setHTMLUnsafe, multi-param custom product route, and CSS Color 4 grammar', () => {
  it.each([
    [
      'document.execCommand("insertHTML", ...)',
      `export default function X() {
         return <button type="button" onClick={() => { document.execCommand('insertHTML', false, '<b>x</b>'); }}>ok</button>;
       }`,
    ],
    [
      'Element.setHTMLUnsafe(...)',
      `export default function X() {
         return <button type="button" onClick={(e) => { (e.currentTarget as unknown as { setHTMLUnsafe: (h: string) => void }).setHTMLUnsafe('<b>x</b>'); }}>ok</button>;
       }`,
    ],
    [
      'Document.parseHTMLUnsafe(...)',
      `export default function X() {
         return <button type="button" onClick={() => { (Document as unknown as { parseHTMLUnsafe: (h: string) => unknown }).parseHTMLUnsafe('<b>x</b>'); }}>ok</button>;
       }`,
    ],
  ])('blocks deprecated and modern raw-HTML APIs: %s', async (_label, code) => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [{ path: 'src/StorefrontApp.tsx', content: code }];
    await expect(compileStorefrontWorker(manifest)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );
  });

  it('selects the final product segment on custom multi-param product routes like /:handle/:productId', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes = [
      { path: '/', view: 'home' },
      { path: '/:handle/:productId', view: 'product' },
    ];
    const requestedUrls: string[] = [];
    const compiled = await compileStorefrontWorker(manifest);
    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'worker.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-07-01',
      bindings: {},
      outboundService: (req: MiniflareRequest) => {
        requestedUrls.push(req.url);
        return new MiniflareResponse(
          JSON.stringify({
            product: {
              id: '1',
              slug: 'sku-1',
              name: 'SKU One',
              brand: 'Apple',
              priceNgn: 1000,
              inStock: true,
              variants: [],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
    });
    try {
      const res = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/phones/sku-1'
      );
      expect(res.status).toBe(200);
      expect(requestedUrls).toEqual([
        'https://catalog.baci.internal/v1/product?productSlug=sku-1',
      ]);
    } finally {
      await mf.dispose();
    }
  });

  it('enforces exact CSS Color 4 functional separator grammar for rgb/rgba, hsl/hsla, and oklch', () => {
    for (const invalidColor of [
      'rgb(255 0 0 0.5)',
      'rgb(255, 0, 0 / 0.5)',
      'rgb(255, 50%, 0)',
      'hsl(222 47% 11% 0.5)',
      'hsl(50% 47% 11%)',
      'oklch(0.6, 0.15, 30)',
      'oklch(0.6 0.15 30 0.8)',
    ]) {
      const m = createOgabasseyStorefrontManifest();
      m.themeTokens.primary = invalidColor;
      expect(() => parseWorkerStorefrontManifest(m)).toThrow();
    }

    for (const validColor of [
      '#0f172a',
      '#0f172acc',
      'rgb(255 0 0 / 0.5)',
      'rgba(255, 0, 0, 0.5)',
      'rgb(100%, 50%, 0%, 80%)',
      'hsl(222 47% 11% / 0.8)',
      'hsl(0 0 100 / 0.1)',
      'hsla(222deg, 47%, 11%, 0.5)',
      'oklch(0.65 0.2 250 / 80%)',
    ]) {
      const m = createOgabasseyStorefrontManifest();
      m.themeTokens.primary = validColor;
      expect(parseWorkerStorefrontManifest(m).themeTokens.primary).toBe(
        validColor
      );
    }
  });

  it.each([
    [
      'window.location.replace',
      `import { useEffect } from 'react';
       export default function X() { useEffect(() => { window.location.replace('https://evil.example'); }, []); return <p>x</p>; }`,
    ],
    [
      'bare location.href',
      `export default function X() { return <button type="button" onClick={() => { location.href = 'https://evil.example'; }}>x</button>; }`,
    ],
    [
      'window.open',
      `export default function X() { return <button type="button" onClick={() => { window.open('https://evil.example'); }}>x</button>; }`,
    ],
    [
      'ambient declare function open bypass',
      `declare function open(url: string): void;
       export default function X() { return <button type="button" onClick={() => { open('https://evil.example'); }}>x</button>; }`,
    ],
    [
      'history.pushState',
      `export default function X() { return <button type="button" onClick={() => { history.pushState({}, '', '/x'); }}>x</button>; }`,
    ],
  ])('rejects direct browser navigation: %s', async (_label, navEscape) => {
    const m = createOgabasseyStorefrontManifest();
    m.files = [{ path: 'src/StorefrontApp.tsx', content: navEscape }];
    await expect(compileStorefrontWorker(m)).rejects.toThrow(
      /Direct browser navigation/
    );
  });

  it('permits local prop named open and SDK commerce.navigation.open', async () => {
    const safeOpen = createOgabasseyStorefrontManifest();
    safeOpen.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          import { useCommerce } from '@baci/experience-sdk';
          function Drawer({ open }: { open: boolean }) { return open ? <div>open</div> : null; }
          export default function App() {
            const commerce = useCommerce();
            return <main onClick={() => { void commerce.navigation.open('/search'); }}><Drawer open={true} /></main>;
          }
        `,
      },
    ];
    expect(
      (await compileStorefrontWorker(safeOpen)).workerCode.length
    ).toBeGreaterThan(500);
  });

  it('scans image-set() string URLs safely without cross-string type() masking or EOF truncation', async () => {
    for (const badCss of [
      `.hero { background-image: image-set("https://images.unsplash.com/pixel.png" 1x); }`,
      `.hero { background-image: image-set("/assets/hero-banner type('" 1x, "https://images.unsplash.com/x" 2x, "')" 3x); }`,
      `.hero { background-image: image-set("https://images.unsplash.com/eof.png"`,
    ]) {
      const m = createOgabasseyStorefrontManifest();
      m.files = [
        { path: 'src/hero.css', content: badCss },
        {
          path: 'src/StorefrontApp.tsx',
          content: `export default function X() { return <main className="hero">ok</main>; }`,
        },
      ];
      await expect(compileStorefrontWorker(m)).rejects.toBeInstanceOf(
        StorefrontCompilerError
      );
    }

    const okImageSet = createOgabasseyStorefrontManifest();
    okImageSet.files = [
      {
        path: 'src/hero.css',
        content: `.hero { background-image: image-set("/assets/hero-banner" type("image/webp") 1x); }`,
      },
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function X() { return <main className="hero">ok</main>; }`,
      },
    ];
    expect((await compileStorefrontWorker(okImageSet)).cssCode).toContain(
      '/assets/hero-banner'
    );
  });

  it('rejects /:__proto__ while preserving /product/:constructor and deeply freezes PLATFORM_VETTED_CSP_BY_DIRECTIVE', async () => {
    const protoRoute = createOgabasseyStorefrontManifest();
    protoRoute.routes.push({ path: '/c/:__proto__', view: 'collection' });
    expect(() => parseWorkerStorefrontManifest(protoRoute)).toThrow(
      /reserved dynamic route segment/
    );

    const ctorRoute = createOgabasseyStorefrontManifest();
    ctorRoute.routes.push({ path: '/product/:constructor', view: 'product' });
    expect(parseWorkerStorefrontManifest(ctorRoute).routes).toHaveLength(6);

    const { PLATFORM_VETTED_CSP_BY_DIRECTIVE } = await import('./csp-header');
    expect(Object.isFrozen(PLATFORM_VETTED_CSP_BY_DIRECTIVE)).toBe(true);
    expect(
      Object.isFrozen(PLATFORM_VETTED_CSP_BY_DIRECTIVE.scriptOrigins)
    ).toBe(true);
    expect(() => {
      (
        PLATFORM_VETTED_CSP_BY_DIRECTIVE.scriptOrigins as unknown as string[]
      ).push('https://evil.example');
    }).toThrow(TypeError);
  });
});

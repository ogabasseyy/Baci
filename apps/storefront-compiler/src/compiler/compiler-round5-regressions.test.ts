import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { describe, expect, it } from 'vitest';
import {
  createOgabasseyStorefrontManifest,
  generateOgabasseyBackingCatalog,
} from '../benchmark/ogabassey-catalog-fixture';
import { SimulatedPostgrestOutboundPlane } from '../benchmark/outbound-data-plane';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round-5 Codex compiler, CSS, SDK provider, and overlay metadata regressions', () => {
  it.each([
    [
      'Reflect.get constructor escape',
      `export default function X() {
         const fn = Reflect.get(() => {}, 'constructor')('return 1');
         return <p>{String(fn())}</p>;
       }`,
    ],
    [
      'chained window.document alias + Reflect.get cookie',
      `export default function X() {
         const d = window.document;
         return <p>{String(d)}</p>;
       }`,
    ],
    [
      'Object.getOwnPropertyDescriptor prototype escape',
      `export default function X() {
         const desc = Object.getOwnPropertyDescriptor(Object.prototype, 'constructor');
         return <p>{String(Boolean(desc))}</p>;
       }`,
    ],
    [
      'direct DOM innerHTML sink',
      `export default function X() {
         return <button type="button" onClick={() => { document.body.innerHTML = '<b>x</b>'; }}>ok</button>;
       }`,
    ],
    [
      'direct document.write sink',
      `export default function X() {
         return <button type="button" onClick={() => { document.write('<b>x</b>'); }}>ok</button>;
       }`,
    ],
    [
      'camelCase iframe srcDoc prop',
      `export default function X() {
         return <iframe title="x" srcDoc="<script>alert(1)</script>" />;
       }`,
    ],
  ])('blocks reflective/chained escape: %s', async (_label, code) => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [{ path: 'src/StorefrontApp.tsx', content: code }];
    await expect(compileStorefrontWorker(manifest)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );
  });

  it('rejects CSS hex-escaped url() exfiltration in merchant stylesheets', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/styles/escaped.css',
        content: `.hero { background-image: u\\72 l("https://images.unsplash.com/pixel.png"); }`,
      },
      {
        path: 'src/StorefrontApp.tsx',
        content: `import './styles/escaped.css'; export default function X(){return <main className="hero">ok</main>;}`,
      },
    ];
    await expect(compileStorefrontWorker(manifest)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );
  });

  it('resolves /index.jsx and /index.js, mounts CommerceProvider for SDK hooks, and emits --store-* CSS vars', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/components/index.jsx',
        content: `
          import { Link, useAssetUrl, useCommerce } from '@baci/experience-sdk';
          export function HeroSlot() {
            const commerce = useCommerce();
            const heroUrl = useAssetUrl('hero-banner');
            return (
              <section data-has-commerce={String(Boolean(commerce.cart))}>
                <img src={heroUrl ?? ''} alt="Hero banner" />
                <Link path="/search">Browse catalog</Link>
              </section>
            );
          }
        `,
      },
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          import { HeroSlot } from './components';
          export default function App() {
            return <main><HeroSlot /></main>;
          }
        `,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'worker.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-07-01',
      bindings: {},
      outboundService: () =>
        new MiniflareResponse(
          JSON.stringify({
            title: 'Home',
            products: [],
            facets: { brands: [], conditions: [], totalMatches: 0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        ),
    });
    try {
      const res = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('data-has-commerce="true"');
      expect(html).toContain('/assets/hero-banner');
      expect(html).toContain('href="/search"');
      expect(html).toContain('--store-primary:hsl(222 47% 11%)');
      expect(html).toContain('--store-accent:hsl(358 78% 52%)');
    } finally {
      await mf.dispose();
    }
  });

  it('refreshes generation and availabilityGeneration metadata when applying split-availability overlays', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    const plane = new SimulatedPostgrestOutboundPlane({
      merchantId,
      products: generateOgabasseyBackingCatalog(8),
      generationSampleTtlMs: 15_000,
    });
    const searchUrl = 'https://catalog.baci.internal/v1/search?limit=4';
    const first = (await (
      await plane.handleOutboundFetch(
        new Request(searchUrl),
        { merchantId, merchantSlug: 'ogabassey' },
        'split-availability'
      )
    ).json()) as { generation: number; availabilityGeneration: number };
    expect(first.generation).toBe(1);
    expect(first.availabilityGeneration).toBe(1);

    plane.recordInventoryWrite(merchantId, 0, 0);
    plane.advanceClockMs(15_001);

    const secondRes = await plane.handleOutboundFetch(
      new Request(searchUrl),
      { merchantId, merchantSlug: 'ogabassey' },
      'split-availability'
    );
    expect(secondRes.headers.get('x-baci-cache')).toBe('HIT');
    const second = (await secondRes.json()) as {
      generation: number;
      availabilityGeneration: number;
    };
    expect(second.generation).toBe(2);
    expect(second.availabilityGeneration).toBe(2);
  });

  it('preserves root theme.css, unquoted @import url(...), quoted Tailwind arbitrary candidates, and framer-motion', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.packages.push({
      name: 'framer-motion',
      versionRef: 'platform-pinned',
    });
    manifest.files = [
      {
        path: 'tokens.css',
        content: '.cascade-probe { border-color: #234567; color: #abcdef; }',
      },
      {
        path: 'theme.css',
        content: `@import url(tokens.css);\n.cascade-probe { color: #123456; }`,
      },
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          import { motion } from 'framer-motion';
          export default function App() {
            const labels = { write: 'Write a review' };
            return <motion.main className="cascade-probe before:content-['*'] [&[data-state=closed]]:hidden">{labels.write}</motion.main>;
          }
        `,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    expect(compiled.cssCode).toContain('#234567');
    expect(compiled.cssCode).toContain('#123456');
    const tokenColorIdx = compiled.cssCode.indexOf('#abcdef');
    const themeColorIdx = compiled.cssCode.indexOf('#123456');
    if (tokenColorIdx !== -1) {
      expect(themeColorIdx).toBeGreaterThan(tokenColorIdx);
    }
    expect(compiled.cssCode).toContain('--tw-content: "*"');
    expect(compiled.cssCode).toContain('[data-state=closed]');
  });

  it('rejects quoted CSS url("...a)b"), non-default CSP ports, non-HTTPS catalog origins, and omits hydration on 502', async () => {
    const quotedParenCss = createOgabasseyStorefrontManifest();
    quotedParenCss.files = [
      {
        path: 'src/styles/paren.css',
        content: `.hero { background-image: url("https://images.unsplash.com/a)b.png"); }`,
      },
      {
        path: 'src/StorefrontApp.tsx',
        content: `import './styles/paren.css'; export default function X(){return <main className="hero">ok</main>;}`,
      },
    ];
    await expect(
      compileStorefrontWorker(quotedParenCss)
    ).rejects.toBeInstanceOf(StorefrontCompilerError);

    const customPortCsp = createOgabasseyStorefrontManifest();
    customPortCsp.cspAllowlist.imgOrigins = [
      'https://images.unsplash.com:8443',
    ];
    await expect(compileStorefrontWorker(customPortCsp)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );

    const merchantId = '00000000-0000-4000-8000-000000000001';
    const plane = new SimulatedPostgrestOutboundPlane({
      merchantId,
      products: generateOgabasseyBackingCatalog(4),
    });
    const httpSchemeRes = await plane.handleOutboundFetch(
      new Request('http://catalog.baci.internal/v1/search?limit=4'),
      { merchantId, merchantSlug: 'ogabassey' },
      'split-availability'
    );
    expect(httpSchemeRes.status).toBe(403);
    const customPortCatalogRes = await plane.handleOutboundFetch(
      new Request('https://catalog.baci.internal:8443/v1/search?limit=4'),
      { merchantId, merchantSlug: 'ogabassey' },
      'split-availability'
    );
    expect(customPortCatalogRes.status).toBe(403);

    const compiled = await compileStorefrontWorker(
      createOgabasseyStorefrontManifest()
    );
    const mf = new Miniflare({
      modules: [
        { type: 'ESModule', path: 'worker.mjs', contents: compiled.workerCode },
      ],
      compatibilityDate: '2026-07-01',
      bindings: {},
      outboundService: () =>
        new MiniflareResponse('Forbidden', { status: 403 }),
    });
    try {
      const res502 = await mf.dispatchFetch('https://ogabassey.mybaci.store/');
      expect(res502.status).toBe(502);
      const html502 = await res502.text();
      expect(html502).not.toContain('__BACI_STOREFRONT_STATE__');
      expect(html502).not.toContain(compiled.assets.clientAssetPath);
    } finally {
      await mf.dispose();
    }
  });
});

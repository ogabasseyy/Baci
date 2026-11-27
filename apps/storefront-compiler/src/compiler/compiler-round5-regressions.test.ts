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
});

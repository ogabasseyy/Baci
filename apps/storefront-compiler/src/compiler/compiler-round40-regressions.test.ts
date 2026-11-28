import vm from 'node:vm';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';
import { buildFramedAnchorInterceptorSnippet } from './framed-anchor-snippet';

describe('Round 40 apex anchor ban, auxclick/shift open, stopImmediatePropagation guard, and /_bacishop route enrichment', () => {
  it('rejects https://usebaci.com JSX anchors and stopImmediatePropagation / capture-phase bypasses at compile time', async () => {
    const escapes = [
      `export default function App() { return <a href="https://usebaci.com/privacy">Privacy</a>; }`,
      `export default function App({ slug = 'privacy' }: { slug?: string }) { return <a href={\`https://usebaci.com/\${slug}\`}>Privacy</a>; }`,
      `export default function App() { return <a href="/smartphones" onClick={(e) => { e.nativeEvent.stopImmediatePropagation(); }}>Phones</a>; }`,
      `export default function App() { return <a href="/smartphones" onClickCapture={(e) => { e.stopPropagation(); }}>Phones</a>; }`,
      `export default function App() { return <form onSubmitCapture={(e) => { e.stopPropagation(); }}><button type="submit">Go</button></form>; }`,
    ];
    for (const content of escapes) {
      const m = createOgabasseyStorefrontManifest();
      m.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(m)).rejects.toThrow(
        StorefrontCompilerError
      );
    }
  });

  it('routes middle-click (auxclick button=1) and shift-click through commerce.navigation.open and disarms stopImmediatePropagation in capture phase', () => {
    const winCaptureListeners: Record<
      string,
      Array<(ev: unknown) => void>
    > = {};
    const containerListeners: Record<string, Array<(ev: unknown) => void>> = {};
    const container = {
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        containerListeners[type] = [...(containerListeners[type] ?? []), fn];
      },
    };
    const openedPaths: string[] = [];
    const goPaths: string[] = [];
    const commerce = {
      checkout: { open: () => ({ status: 'ok' }) },
      navigation: {
        go: (p: string) => {
          goPaths.push(p);
          return { status: 'ok' };
        },
        open: (p: string) => {
          openedPaths.push(p);
          return { status: 'ok', value: { presented: true } };
        },
      },
    };

    vm.runInNewContext(
      `${buildFramedAnchorInterceptorSnippet()}\nattachFramedNavigationInterceptors(container, commerce, { merchantSlug: 'ogabassey', pathname: '/' }, () => '/', () => {});`,
      {
        URL,
        WeakSet,
        Promise,
        setTimeout,
        TRUSTED_HOST_ORIGIN: '',
        window: {
          parent: {},
          addEventListener: (
            type: string,
            fn: (ev: unknown) => void,
            capture?: boolean
          ) => {
            if (capture) {
              winCaptureListeners[type] = [
                ...(winCaptureListeners[type] ?? []),
                fn,
              ];
            }
          },
        },
        document: { baseURI: 'https://ogabassey.usebaci.com/' },
        container,
        commerce,
      }
    );

    const anchorTarget = {
      tagName: 'A',
      hasAttribute: (n: string) => n === 'href',
      getAttribute: (n: string) => (n === 'href' ? '/smartphones' : null),
    };

    // 1. Middle-click auxclick (button === 1) -> navigation.open
    let auxPrevented = false;
    const auxEvent = {
      type: 'auxclick',
      button: 1,
      defaultPrevented: false,
      preventDefault() {
        auxPrevented = true;
        this.defaultPrevented = true;
      },
      target: anchorTarget,
    };
    for (const fn of containerListeners.auxclick ?? []) fn(auxEvent);
    expect(auxPrevented).toBe(true);
    expect(openedPaths).toEqual(['/smartphones']);

    // 2. Shift-click -> navigation.open
    let shiftPrevented = false;
    const shiftEvent = {
      type: 'click',
      button: 0,
      shiftKey: true,
      defaultPrevented: false,
      preventDefault() {
        shiftPrevented = true;
        this.defaultPrevented = true;
      },
      target: anchorTarget,
    };
    for (const fn of containerListeners.click ?? []) fn(shiftEvent);
    expect(shiftPrevented).toBe(true);
    expect(openedPaths).toEqual(['/smartphones', '/smartphones']);

    // 3. Capture-phase disarm ensures stopImmediatePropagation cannot block sibling container listener
    let immediateBlocked = false;
    let clickPrevented = false;
    const stopImmEvent: Record<string, unknown> = {
      type: 'click',
      button: 0,
      defaultPrevented: false,
      stopPropagation: () => {},
      stopImmediatePropagation: () => {
        immediateBlocked = true;
      },
      preventDefault() {
        clickPrevented = true;
        stopImmEvent.defaultPrevented = true;
      },
      target: anchorTarget,
    };
    for (const fn of winCaptureListeners.click ?? []) fn(stopImmEvent);
    (stopImmEvent.stopImmediatePropagation as () => void)();
    expect(immediateBlocked).toBe(false);
    for (const fn of containerListeners.click ?? []) fn(stopImmEvent);
    expect(clickPrevented).toBe(true);
    expect(goPaths).toEqual(['/smartphones']);
  });

  it('allows /_bacishop/... route enrichment on /_baci/catalog?op=route while still blocking /_baci and /_baci/*', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.routes.push({ path: '/_bacishop/:category', view: 'collection' });
    const compiled = await compileStorefrontWorker(manifest);
    const seenOutboundUrls: string[] = [];
    const mf = new Miniflare({
      modules: true,
      script: compiled.workerCode,
      compatibilityDate: '2025-12-01',
      outboundService(req: { url: string }) {
        seenOutboundUrls.push(req.url);
        return Response.json({
          generation: 1,
          availabilityGeneration: 1,
          categoryExists: true,
          products: [],
          facets: { brands: [], conditions: [], totalMatches: 0 },
        });
      },
    });
    try {
      const okRes = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=route&path=%2F_bacishop%2Fsmartphones'
      );
      expect(okRes.status).toBe(200);
      const okBody = (await okRes.json()) as {
        status: string;
        value: { view: string; pathname: string; publicDataRevision: string };
      };
      expect(okBody.status).toBe('ok');
      expect(okBody.value.view).toBe('collection');
      expect(okBody.value.publicDataRevision).toBe('1:1');
      expect(okBody.value.pathname).toBe('/_bacishop/smartphones');
      expect(
        seenOutboundUrls.some((u) => u.includes('category=smartphones'))
      ).toBe(true);

      const blockedExact = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=route&path=%2F_baci'
      );
      expect(blockedExact.status).toBe(400);

      const blockedPrefix = await mf.dispatchFetch(
        'https://ogabassey.mybaci.store/_baci/catalog?op=route&path=%2F_baci%2Fcatalog'
      );
      expect(blockedPrefix.status).toBe(400);
    } finally {
      await mf.dispose();
    }
  });
});

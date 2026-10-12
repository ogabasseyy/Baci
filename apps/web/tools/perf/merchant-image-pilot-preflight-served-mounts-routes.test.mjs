import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { fetchServedAgreement } from './merchant-image-pilot-preflight-served.mjs';
import {
  labHtml,
  MERCHANT,
  mountFor,
  serveStaged,
  setupOffline,
  setupOfflineAssets,
} from './merchant-image-pilot-preflight-served-fixtures.mjs';

describe('preflight served gate', () => {
  it('fails pilot mounts that serve the wrong generation', async () => {
    const fixture = await setupOffline();
    const [logo] = fixture.assets;
    const html = labHtml({ arm: 'pilot', ...fixture });
    const wrongGen = {
      ...mountFor(logo),
      generationId: 'f'.repeat(64),
    };
    const report = await fetchServedAgreement('http://unused.invalid', {
      arms: ['pilot'],
      expectedBindings: [`${MERCHANT}/logo-a`, `${MERCHANT}/hero-s0`],
      expectedMounts: [wrongGen],
      fetchImpl: async () => html,
      publicDir: fixture.publicDir,
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(
      /pilot logo mount serves bytes outside this generation/
    );
  });

  it('fails pilot mounts with a mixed approved/unreviewed ladder', async () => {
    const fixture = await setupOffline();
    const [logo] = fixture.assets;
    // Approved candidates plus one unreviewed 1280w rung in the LOGO
    // section: the existential check would pass on the approved subset
    // while a wide viewport renders unreviewed bytes.
    const [pageHead, pageTail] = labHtml({ arm: 'pilot', ...fixture }).split(
      'header-logo'
    );
    const html = `${pageHead}header-logo${pageTail.replace(
      ' 384w',
      ` 384w, /__pilot/${'f'.repeat(64)}/evil.avif 1280w`
    )}`;
    const report = await fetchServedAgreement('http://unused.invalid', {
      arms: ['pilot'],
      expectedBindings: [`${MERCHANT}/logo-a`, `${MERCHANT}/hero-s0`],
      expectedMounts: [mountFor(logo)],
      fetchImpl: async () => html,
      publicDir: fixture.publicDir,
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/outside this generation/);
  });

  it('fails pilot mounts with an unreviewed WebP rung and clean AVIF', async () => {
    // AVIF-only prefix checking would pass this ladder: every AVIF
    // candidate is approved while the WebP source serves an unreviewed
    // generation. Every typed source must carry the approved generation.
    const fixture = await setupOffline();
    const [logo] = fixture.assets;
    const [pageHead, pageTail] = labHtml({ arm: 'pilot', ...fixture }).split(
      'header-logo'
    );
    const html = `${pageHead}header-logo${pageTail.replace(
      /(\S+ 384w)(" type="image\/webp")/,
      `$1, /__pilot/${'f'.repeat(64)}/evil.webp 1280w$2`
    )}`;
    const report = await fetchServedAgreement('http://unused.invalid', {
      arms: ['pilot'],
      expectedBindings: [`${MERCHANT}/logo-a`, `${MERCHANT}/hero-s0`],
      expectedMounts: [mountFor(logo)],
      fetchImpl: async () => html,
      publicDir: fixture.publicDir,
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/outside this generation/);
  });

  it('accepts same-origin absolute staged URLs on a store control card', async () => {
    const fixture = await setupOfflineAssets([
      {
        assetId: 'card-a',
        generationId: 'c'.repeat(64),
        ladder: [384, 768, 1280],
        role: 'product',
        slot: 'product-card',
        url: 'https://cdn.example.com/media/card-a.png',
      },
    ]);
    const [card] = fixture.assets;
    const mount = mountFor(card);
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      if (urlPath.startsWith('/pilot-lab/store/')) {
        const origin = `http://${req.headers.host}`;
        const absolute = `${origin}${card.stagedOriginal}`;
        const body = `<!doctype html><html><head></head><body><main data-pilot-lab-arm="control"><section data-pilot-lab-slot="product-card" data-pilot-lab-binding="${mount.binding}"><div data-pilot-lab-selected-card="true"><img alt="lab card" fetchpriority="high" loading="eager" sizes="(max-width: 640px) 100vw, 50vw" src="${absolute}?w=640&q=75" srcset="${absolute}?w=640&q=75 640w, ${absolute}?w=750&q=75 750w"/></div></section></main></body></html>`;
        res.writeHead(200, { 'content-type': 'text/html' }).end(body);
        return;
      }
      if (urlPath.startsWith('/__pilot/')) {
        serveStaged(res, fixture.publicDir, urlPath).catch(() =>
          res.writeHead(500).end('error')
        );
        return;
      }
      res.writeHead(404).end('nope');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['control'],
        expectedBindings: [mount.binding],
        expectedMounts: [mount],
        pages: [
          {
            bindings: [mount.binding],
            mounts: [mount],
            path: '/pilot-lab/store/labstore',
            surface: 'store',
          },
        ],
        publicDir: fixture.publicDir,
        stagedHashes: { [card.stagedOriginal]: card.sourceSha },
      });
      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
      for (const gate of ['mount-coverage', 'descriptors', 'response-bytes']) {
        expect(
          report.checks.some(
            (check) =>
              check.name === `served:store:labstore:control:${gate}` && check.ok
          )
        ).toBe(true);
      }
      expect(report.coverage[0].mounted).toEqual([mount.binding]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('requires declared uncovered markers on store pages', async () => {
    const fixture = await setupOffline();
    const marker = `<section data-pilot-lab-slot="hero-banner" data-pilot-lab-status="uncovered-consumer"><h2>hero-banner — uncovered consumer</h2></section>`;
    const page = () => ({
      bindings: [],
      mounts: [],
      path: '/pilot-lab/store/labstore',
      surface: 'store',
      uncovered: [{ slotId: 'hero-banner' }],
    });
    const check = (html) =>
      fetchServedAgreement('http://127.0.0.1:1', {
        arms: ['pilot'],
        expectedBindings: [],
        fetchImpl: async () =>
          `<main data-pilot-lab-arm="pilot">${html}</main>`,
        pages: [page()],
        publicDir: fixture.publicDir,
      });
    const present = await check(marker);
    expect(present.failures).toEqual([]);
    expect(present.ok).toBe(true);
    expect(present.coverage[0].uncovered).toEqual(['hero-banner']);
    const dropped = await check('');
    expect(dropped.ok).toBe(false);
    expect(dropped.failures.join('\n')).toMatch(
      /uncovered-consumer marker for slot "hero-banner" is absent/
    );
  });
});

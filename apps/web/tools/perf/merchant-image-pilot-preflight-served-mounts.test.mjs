import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchServedAgreement } from './merchant-image-pilot-preflight-served.mjs';
import {
  contentTypeFor,
  labHtml,
  MERCHANT,
  mountFor,
  notOptimizedSection,
  replaceHeroSection,
  serveStaged,
  setupOffline,
  setupOfflineAssets,
} from './merchant-image-pilot-preflight-served-fixtures.mjs';

describe('preflight served gate', () => {
  it('proves every expected binding renders in the served arm', async () => {
    const fixture = await setupOffline();
    const html = labHtml({ arm: 'pilot', ...fixture });
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      if (urlPath === '/pilot-lab?arm=pilot') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
        return;
      }
      if (urlPath.startsWith('/__pilot/')) {
        readFile(join(fixture.publicDir, urlPath))
          .then((bytes) =>
            res
              .writeHead(200, {
                'content-type': contentTypeFor(urlPath.split('?')[0]),
              })
              .end(bytes)
          )
          .catch(() => res.writeHead(404).end('missing'));
        return;
      }
      res.writeHead(404).end('nope');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const expectedBindings = [`${MERCHANT}/hero-s0`, `${MERCHANT}/logo-a`];
      const covered = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        expectedBindings,
        publicDir: fixture.publicDir,
      });
      expect(covered.failures).toEqual([]);
      expect(covered.ok).toBe(true);
      const dropped = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        expectedBindings: [...expectedBindings, `${MERCHANT}/ghost`],
        publicDir: fixture.publicDir,
      });
      expect(dropped.ok).toBe(false);
      expect(dropped.failures.join('\n')).toMatch(/binding-coverage/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('fails when an expected hero renders only not-optimized (review-2 repro)', async () => {
    const fixture = await setupOffline();
    const [logo] = fixture.assets;
    const heroBinding = `${MERCHANT}/hero-s0`;
    // Valid logo mount, hero reporting row only — the review's step-5 shape.
    const html = replaceHeroSection(
      labHtml({ arm: 'pilot', ...fixture }),
      notOptimizedSection(heroBinding, 'mobile-hero-slide-0')
    );
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      if (urlPath === '/pilot-lab?arm=pilot') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
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
      const expectedMounts = [
        {
          assetId: 'hero-s0',
          binding: heroBinding,
          generationId: 'd'.repeat(64),
          merchantId: MERCHANT,
          role: 'hero',
          slotId: 'mobile-hero-slide-0',
          stagedOriginal: `/__pilot/originals/${MERCHANT}-hero-s0.png`,
        },
        mountFor(logo),
      ];
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        expectedBindings: expectedMounts.map((mount) => mount.binding),
        expectedMounts,
        publicDir: fixture.publicDir,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/mount-coverage/);
      expect(report.failures.join('\n')).toMatch(
        /renders only "not-optimized"/
      );
      expect(report.coverage[0].mounted).toEqual([`${MERCHANT}/logo-a`]);
      expect(report.coverage[0].reported).toEqual([
        {
          binding: heroBinding,
          slotId: 'mobile-hero-slide-0',
          status: 'not-optimized',
        },
      ]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('excludes rejected bindings from optimized coverage (reported, not counted)', async () => {
    const fixture = await setupOffline();
    const [logo] = fixture.assets;
    const heroBinding = `${MERCHANT}/hero-s0`;
    const html = replaceHeroSection(
      labHtml({ arm: 'pilot', ...fixture }),
      notOptimizedSection(heroBinding, 'mobile-hero-slide-0')
    );
    // Offline rejected the hero: it is absent from expectedMounts, exactly
    // as runOfflinePreflight reports it.
    const report = await fetchServedAgreement('http://unused.invalid', {
      arms: ['pilot'],
      expectedBindings: [heroBinding, `${MERCHANT}/logo-a`],
      expectedMounts: [mountFor(logo)],
      fetchImpl: async () => html,
      publicDir: fixture.publicDir,
    });
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.coverage[0].mounted).toEqual([`${MERCHANT}/logo-a`]);
    expect(report.coverage[0].reported).toEqual([
      {
        binding: heroBinding,
        slotId: 'mobile-hero-slide-0',
        status: 'not-optimized',
      },
    ]);
  });

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
      /pilot logo mount does not serve this generation/
    );
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
});

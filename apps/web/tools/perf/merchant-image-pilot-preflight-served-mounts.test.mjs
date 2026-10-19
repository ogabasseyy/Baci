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
      const stagedHashes = Object.fromEntries(
        fixture.tiers.map((tier) => [
          `/__pilot/${fixture.generationId}/${tier.path}`,
          tier.sha256,
        ])
      );
      const covered = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        expectedBindings,
        publicDir: fixture.publicDir,
        stagedHashes,
      });
      expect(covered.failures).toEqual([]);
      expect(covered.ok).toBe(true);
      const dropped = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        expectedBindings: [...expectedBindings, `${MERCHANT}/ghost`],
        publicDir: fixture.publicDir,
        stagedHashes,
      });
      expect(dropped.ok).toBe(false);
      expect(dropped.failures.join('\n')).toMatch(/binding-coverage/);
      const extra = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        expectedBindings: [`${MERCHANT}/hero-s0`],
        publicDir: fixture.publicDir,
        stagedHashes,
      });
      expect(extra.ok).toBe(false);
      expect(extra.failures.join('\n')).toMatch(
        /unexpected bindings: .*\/logo-a/
      );
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
});

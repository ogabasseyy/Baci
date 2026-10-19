import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  runOfflinePreflight,
  runPreflight,
} from './merchant-image-pilot-preflight.mjs';
import {
  offlineOptions,
  setupOffline,
  setupOfflineAssets,
  storeLogoControlPage,
  storeLogoPilotPage,
} from './merchant-image-pilot-preflight-fixtures.mjs';
import {
  labHtml,
  MERCHANT,
  notOptimizedSection,
  replaceHeroSection,
  serveStaged,
} from './merchant-image-pilot-preflight-served-fixtures.mjs';

describe('preflight entry orchestration', () => {
  it('combines offline and served gates', async () => {
    const fixture = await setupOffline();
    const offlineOnly = await runPreflight(offlineOptions(fixture));
    expect(offlineOnly.ok).toBe(true);
    expect(offlineOnly.served).toBeNull();
  });

  it('writes the accepted mounts only when the offline gate passes', async () => {
    const fixture = await setupOffline();
    const mountsPath = join(fixture.publicDir, 'mounts.json');
    const report = await runPreflight(
      offlineOptions(fixture, { writeMounts: mountsPath })
    );
    expect(report.ok).toBe(true);
    expect(JSON.parse(await readFile(mountsPath, 'utf8'))).toEqual(
      report.accepted
    );
    expect(report.accepted).toHaveLength(1);
  });

  it('refuses to write mounts when the offline gate fails', async () => {
    const fixture = await setupOffline();
    const mountsPath = join(fixture.publicDir, 'mounts.json');
    const report = await runPreflight(
      offlineOptions(fixture, {
        inventory: join(fixture.publicDir, 'missing.json'),
        writeMounts: mountsPath,
      })
    );
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/mounts not written/);
    await expect(readFile(mountsPath, 'utf8')).rejects.toThrow();
  });

  it('removes a stale mounts artifact when the offline gate fails', async () => {
    // A previous successful run wrote mounts.json; the next offline run
    // fails (new binding, rejected inputs). The stale list must not
    // survive: readiness consumes it as the complete authority and would
    // otherwise report green on outdated expectations.
    const fixture = await setupOffline();
    const mountsPath = join(fixture.publicDir, 'mounts.json');
    const passing = await runPreflight(
      offlineOptions(fixture, { writeMounts: mountsPath })
    );
    expect(passing.ok).toBe(true);
    expect(JSON.parse(await readFile(mountsPath, 'utf8'))).toEqual(
      passing.accepted
    );
    const failing = await runPreflight(
      offlineOptions(fixture, {
        inventory: join(fixture.publicDir, 'missing.json'),
        writeMounts: mountsPath,
      })
    );
    expect(failing.ok).toBe(false);
    await expect(readFile(mountsPath, 'utf8')).rejects.toThrow();
  });

  it('fails closed when the lab-stores override omits a merchant', async () => {
    // A custom --lab-stores file without the inventory merchant must
    // fail: silently defaulting to zero uncovered consumers would let
    // the served gate report green without requiring the omitted
    // route-matrix markers.
    const fixture = await setupOffline();
    const override = join(fixture.publicDir, 'lab-stores.json');
    await writeFile(override, `${JSON.stringify([])}\n`);
    const report = await runPreflight({
      ...offlineOptions(fixture),
      labStores: override,
      origin: 'http://127.0.0.1:1',
      storeMap: `${MERCHANT}=labstore`,
    });
    expect(report.ok).toBe(false);
    expect(report.served).toBeNull();
    expect(report.failures.join('\n')).toMatch(
      /served:lab-stores: .*has no entry for merchants/
    );
  });

  it('fails closed when a merchant has no store slug', async () => {
    const fixture = await setupOffline();
    const report = await runPreflight({
      ...offlineOptions(fixture),
      origin: 'http://127.0.0.1:1',
      storeMap: null,
    });
    expect(report.ok).toBe(false);
    expect(report.served).toBeNull();
    expect(report.failures.join('\n')).toMatch(/store-map/);
  });

  it('removes stale mounts when the served gate fails', async () => {
    // Mounts publish only after the COMPLETE preflight succeeds: a
    // served failure (bad store map, unreachable origin) must remove
    // any prior artifact instead of leaving a valid-looking authority
    // for defects the served gate caught (orphan preloads, bad rungs).
    const fixture = await setupOffline();
    const mountsPath = join(fixture.publicDir, 'mounts.json');
    const passing = await runPreflight(
      offlineOptions(fixture, { writeMounts: mountsPath })
    );
    expect(passing.ok).toBe(true);
    const unmapped = await runPreflight({
      ...offlineOptions(fixture),
      origin: 'http://127.0.0.1:1',
      storeMap: null,
      writeMounts: mountsPath,
    });
    expect(unmapped.ok).toBe(false);
    expect(unmapped.failures.join('\n')).toMatch(
      /mounts not written: served gate failed/
    );
    await expect(readFile(mountsPath, 'utf8')).rejects.toThrow();
    // Republish, then fail inside the served fetch itself.
    const republished = await runPreflight(
      offlineOptions(fixture, { writeMounts: mountsPath })
    );
    expect(republished.ok).toBe(true);
    const unreachable = await runPreflight({
      ...offlineOptions(fixture),
      origin: 'http://127.0.0.1:1',
      storeMap: `${MERCHANT}=labstore`,
      timeoutMs: 50,
      writeMounts: mountsPath,
    });
    expect(unreachable.ok).toBe(false);
    expect(unreachable.failures.join('\n')).toMatch(
      /mounts not written: served gate failed/
    );
    await expect(readFile(mountsPath, 'utf8')).rejects.toThrow();
  });

  it('fails offline on the quality-zero hero while served correctly excludes it', async () => {
    const fixture = await setupOfflineAssets([
      {
        assetId: 'logo-a',
        ladder: [96, 192, 384],
        role: 'logo',
        slot: 'header-logo',
        url: 'https://cdn.example.com/media/logo-a.png',
      },
      {
        assetId: 'hero-s0',
        ladder: [384, 768, 1280],
        role: 'hero',
        slot: 'mobile-hero-slide-0',
        url: 'https://cdn.example.com/media/hero-s0.png',
      },
    ]);
    const [logo, hero] = fixture.assets;
    // The review's exact mutation: quality 0, bytes/hashes/ladder unchanged.
    const manifestPath = join(
      fixture.outputRoot,
      'generations',
      hero.generationId,
      'manifest.json'
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.tiers[0].quality = 0;
    await writeFile(manifestPath, JSON.stringify(manifest));

    const offline = await runOfflinePreflight(offlineOptions(fixture));
    expect(offline.ok).toBe(false);
    expect(offline.failures.join('\n')).toMatch(/quality/);
    expect(offline.accepted.map((entry) => entry.binding)).toEqual([
      `${MERCHANT}/logo-a`,
    ]);

    // Served pages reflect the route's invalid-manifest fallback: the hero
    // renders a reporting row on every surface while the logo stays mounted.
    const heroRow = notOptimizedSection(
      `${MERCHANT}/hero-s0`,
      'mobile-hero-slide-0'
    );
    const galleryFor = (arm) => {
      const logoPage = labHtml({
        arm,
        generationId: logo.generationId,
        tiers: logo.tiers,
      });
      const page = replaceHeroSection(logoPage, heroRow);
      if (arm === 'pilot') {
        return page;
      }
      // Gallery control mounts serve the bare staged original (no tier
      // URLs, no AVIF gate on the hint).
      return page
        .replace(
          'fetchPriority="high" type="image/avif" data-pilot-lab-preload',
          'fetchPriority="high" data-pilot-lab-preload'
        )
        .replaceAll(/srcSet="[^"]*"/g, `srcSet="${logo.stagedOriginal}"`)
        .replaceAll(
          /href="\/__pilot\/[^"]*"/g,
          `href="${logo.stagedOriginal}"`
        );
    };
    const pages = {
      '/pilot-lab?arm=pilot': galleryFor('pilot'),
      '/pilot-lab?arm=control': galleryFor('control'),
      '/pilot-lab/store/labstore?arm=pilot': storeLogoPilotPage({
        arm: 'pilot',
        asset: logo,
        heroRow,
      }),
      '/pilot-lab/store/labstore?arm=control': storeLogoControlPage({
        asset: logo,
        heroRow,
      }),
    };
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      const body = pages[urlPath];
      if (body) {
        res.writeHead(200, { 'content-type': 'text/html' }).end(body);
        return;
      }
      if (urlPath.split('?')[0].startsWith('/__pilot/')) {
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
      const report = await runPreflight({
        ...offlineOptions(fixture),
        origin,
        storeMap: `${MERCHANT}=labstore`,
      });
      // Combined verdict fails via offline (the schema-invalid hero), while
      // every served mount gate passes (the hero is reported, not counted).
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/quality/);
      expect(report.failures.join('\n')).not.toMatch(/mount-coverage/);
      expect(report.coverage).toHaveLength(4);
      for (const entry of report.coverage) {
        expect(entry.mounted).toEqual([`${MERCHANT}/logo-a`]);
        expect(entry.reported).toEqual([
          {
            binding: `${MERCHANT}/hero-s0`,
            slotId: 'mobile-hero-slide-0',
            status: 'not-optimized',
          },
        ]);
      }
      expect(
        report.checks.some(
          (check) =>
            check.name === 'served:store:labstore:pilot:mount-coverage' &&
            check.ok
        )
      ).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

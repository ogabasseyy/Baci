import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { RECIPE_ID } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import {
  runOfflinePreflight,
  runPreflight,
} from './merchant-image-pilot-preflight.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR_FIXTURES = join(
  here,
  '..',
  '..',
  '..',
  '..',
  'infra',
  'cdn-transformer',
  'pilot',
  'fixtures'
);
const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const RECIPE = RECIPE_ID;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function setupOfflineAssets(assets) {
  const base = join(
    tmpdir(),
    `pilot-preflight-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  const publicDir = join(base, 'public');
  await mkdir(inputRoot, { recursive: true });
  await mkdir(publicDir, { recursive: true });
  const staged = [];
  for (const asset of assets) {
    const merchantId = asset.merchantId ?? MERCHANT;
    const sourcePath = `${asset.assetId}.png`;
    // 2000px-wide source: every role ladder fits without upscaling (the
    // manifest contract rejects upscaled claims), and the 4:1 aspect keeps
    // rung heights exact.
    await copyFile(
      join(GENERATOR_FIXTURES, 'wide-2000x500.png'),
      join(inputRoot, sourcePath)
    );
    const snapshot = await readFile(join(inputRoot, sourcePath));
    const sourceSha = sha256(snapshot);
    const sourceMeta = await sharp(snapshot).metadata();
    const generationDir = join(outputRoot, 'generations', asset.generationId);
    await mkdir(generationDir, { recursive: true });
    // Real encodings on the genuine role ladder so descriptor checks verify
    // actual decoded dimensions, not string shapes. Aspect-preserving
    // downscale; claimed geometry is read back from the decoded bytes.
    const tiers = [];
    for (const width of asset.ladder) {
      for (const format of ['avif', 'webp']) {
        const bytes = await sharp(snapshot)
          .resize(Math.min(width, sourceMeta.width))
          .toFormat(format)
          .toBuffer();
        const decoded = await sharp(bytes).metadata();
        const hash = sha256(bytes);
        const fileName = `${hash}.${format}`;
        await writeFile(join(generationDir, fileName), bytes);
        tiers.push({
          actualWidth: decoded.width,
          bytes: bytes.length,
          contentType: `image/${format}`,
          // png source: capped rungs generate, larger rungs take the
          // explicit over-source exception.
          delivery:
            bytes.length <= snapshot.length
              ? 'generated'
              : 'generated-over-source',
          format,
          height: decoded.height,
          path: fileName,
          quality: 70,
          requestedWidth: width,
          sha256: hash,
          width: decoded.width,
        });
      }
    }
    await writeFile(
      join(generationDir, 'manifest.json'),
      JSON.stringify({
        assetId: asset.assetId,
        createdAt: '2026-10-01T20:00:00.000Z',
        encoder: {
          libvipsVersion: '8.18.6',
          name: 'sharp',
          sharpVersion: '0.35.4',
        },
        merchantId,
        policyVersion: 1,
        recipeId: RECIPE,
        role: asset.role,
        schemaVersion: 1,
        source: {
          bytes: snapshot.length,
          format: 'png',
          orientedHeight: sourceMeta.height,
          orientedWidth: sourceMeta.width,
          sha256: sourceSha,
        },
        tiers,
      })
    );
    // Mirror the lab-config staging layout: committed bytes plus the frozen
    // original under the lab base URL.
    const stageDir = join(publicDir, '__pilot', asset.generationId);
    await mkdir(stageDir, { recursive: true });
    for (const tier of tiers) {
      await copyFile(join(generationDir, tier.path), join(stageDir, tier.path));
    }
    const originalsDir = join(publicDir, '__pilot', 'originals');
    await mkdir(originalsDir, { recursive: true });
    const originalName = `${merchantId}-${asset.assetId}.png`;
    await copyFile(
      join(inputRoot, sourcePath),
      join(originalsDir, originalName)
    );
    staged.push({
      assetId: asset.assetId,
      generationId: asset.generationId,
      merchantId,
      record: {
        assetId: asset.assetId,
        merchantId,
        role: asset.role,
        sha256: sourceSha,
        slot: asset.slot,
        sourcePath,
        url: asset.url,
      },
      role: asset.role,
      slot: asset.slot,
      sourceSha,
      stagedOriginal: `/__pilot/originals/${originalName}`,
      tiers,
    });
  }
  const inventoryPath = join(inputRoot, 'inventory.json');
  await writeFile(
    inventoryPath,
    JSON.stringify(staged.map((entry) => entry.record))
  );
  const acceptancesPath = join(outputRoot, 'acceptances.json');
  await writeFile(
    acceptancesPath,
    JSON.stringify(
      staged.map((entry) => ({
        assetId: entry.assetId,
        generationId: entry.generationId,
        merchantId: entry.merchantId,
        note: 'Lab review: fixture acceptance.',
        outputHashes: entry.tiers.map((tier) => tier.sha256),
        recipeId: RECIPE,
        reviewedAt: '2026-10-01T21:00:00.000Z',
        reviewer: 'pilot-owner',
        schemaVersion: 1,
        sourceSha256: entry.sourceSha,
        verdict: 'accepted',
      }))
    )
  );
  return {
    acceptancesPath,
    assets: staged,
    base,
    inputRoot,
    inventoryPath,
    outputRoot,
    publicDir,
  };
}

async function setupOffline() {
  const fixture = await setupOfflineAssets([
    {
      assetId: 'logo-a',
      generationId: 'e'.repeat(64),
      ladder: [96, 192, 384],
      role: 'logo',
      slot: 'header-logo',
      url: 'https://cdn.example.com/media/logo-a.png',
    },
  ]);
  const [only] = fixture.assets;
  return { ...fixture, generationId: only.generationId, tiers: only.tiers };
}

function offlineOptions(fixture, overrides = {}) {
  return {
    acceptances: fixture.acceptancesPath,
    inputRoot: fixture.inputRoot,
    inventory: fixture.inventoryPath,
    outputRoot: fixture.outputRoot,
    publicDir: fixture.publicDir,
    recipe: RECIPE,
    ...overrides,
  };
}

function labHtml({ arm, generationId, tiers }) {
  const srcSetFor = (format) =>
    tiers
      .filter((tier) => tier.format === format)
      .map((tier) => `/__pilot/${generationId}/${tier.path} ${tier.width}w`)
      .join(', ');
  const avif = srcSetFor('avif');
  const webp = srcSetFor('webp');
  const smallestTier = tiers.find((tier) => tier.format === 'avif');
  const smallest = smallestTier
    ? `/__pilot/${generationId}/${smallestTier.path}`
    : `/__pilot/${generationId}/placeholder.avif`;
  return `<!doctype html><html><body><main data-pilot-lab-arm="${arm}">
<section data-pilot-lab-slot="mobile-hero-slide-0" data-pilot-lab-binding="${MERCHANT}/hero-s0"><link rel="preload" as="image" href="${smallest}" imageSrcSet="${avif}" imageSizes="(max-width: 768px) 40vw, 152px" media="(max-width: 768px)" fetchPriority="high" type="image/avif" data-pilot-lab-preload="${arm}" data-pilot-lab-binding="${MERCHANT}/hero-s0"/><picture data-pilot-lab-picture="${arm}"><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${avif}" type="image/avif"/><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${webp}"/></picture></section>
<section data-pilot-lab-slot="header-logo" data-pilot-lab-binding="${MERCHANT}/logo-a"><picture data-pilot-lab-picture="${arm}"><source sizes="40px" srcSet="${avif}" type="image/avif"/><source sizes="40px" srcSet="${webp}" type="image/webp"/></picture></section>
</main></body></html>`;
}

function notOptimizedSection(binding, slotId) {
  return `<section data-pilot-lab-slot="${slotId}" data-pilot-lab-binding="${binding}" data-pilot-lab-status="not-optimized"><h2>${slotId} — not optimized</h2><p>fixture row</p></section>`;
}

function replaceHeroSection(html, replacement) {
  return String(html).replace(
    /<section data-pilot-lab-slot="mobile-hero-slide-0"[\s\S]*?<\/section>/,
    replacement
  );
}

async function serveStaged(res, publicDir, urlPath) {
  // Static serving ignores the query: original-renderer ?w&q URLs hash
  // against the query-stripped staged file.
  const base = urlPath.split('?')[0];
  try {
    const bytes = await readFile(join(publicDir, base));
    res
      .writeHead(200, { 'content-type': 'application/octet-stream' })
      .end(bytes);
  } catch {
    res.writeHead(404).end('missing');
  }
}

function srcSetFor(asset, generationId, format) {
  return asset.tiers
    .filter((tier) => tier.format === format)
    .map((tier) => `/__pilot/${generationId}/${tier.path} ${tier.width}w`)
    .join(', ');
}

function storeLogoPilotPage({ arm, asset, heroRow }) {
  const avif = srcSetFor(asset, asset.generationId, 'avif');
  const webp = srcSetFor(asset, asset.generationId, 'webp');
  const fallback = asset.tiers.find((tier) => tier.format === 'webp');
  return `<!doctype html><html><body><div data-pilot-lab-arm="${arm}"><main><section data-pilot-lab-binding="${asset.merchantId}/${asset.assetId}" data-pilot-lab-slot="header-logo"><header data-pilot-lab-store-header="Labstore"><a href="/pilot-lab/store/labstore/"><picture data-pilot-lab-header-logo="true"><source sizes="40px" srcSet="${avif}" type="image/avif"/><source sizes="40px" srcSet="${webp}" type="image/webp"/><img src="/__pilot/${asset.generationId}/${fallback.path}" alt="Labstore" width="40" height="40"/></picture><span>Labstore</span></a></header></section>${heroRow}</main></div></body></html>`;
}

function storeLogoControlPage({ asset, heroRow }) {
  const staged = asset.stagedOriginal;
  return `<!doctype html><html><body><div data-pilot-lab-arm="control"><main><section data-pilot-lab-binding="${asset.merchantId}/${asset.assetId}" data-pilot-lab-slot="header-logo"><header data-pilot-lab-store-header="Labstore"><a href="/pilot-lab/store/labstore/"><img src="${staged}?w=48&q=75" srcSet="${staged}?w=48&q=75 1x, ${staged}?w=96&q=75 2x" alt="Labstore" width="40" height="40"/></a></header></section>${heroRow}</main></div></body></html>`;
}

describe('preflight entry orchestration', () => {
  it('combines offline and served gates', async () => {
    const fixture = await setupOffline();
    const offlineOnly = await runPreflight(offlineOptions(fixture));
    expect(offlineOnly.ok).toBe(true);
    expect(offlineOnly.served).toBeNull();
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

  it('fails offline on the quality-zero hero while served correctly excludes it', async () => {
    const fixture = await setupOfflineAssets([
      {
        assetId: 'logo-a',
        generationId: 'e'.repeat(64),
        ladder: [96, 192, 384],
        role: 'logo',
        slot: 'header-logo',
        url: 'https://cdn.example.com/media/logo-a.png',
      },
      {
        assetId: 'hero-s0',
        generationId: 'd'.repeat(64),
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

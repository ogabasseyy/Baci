import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { RECIPE_ID } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { fetchServedAgreement } from './merchant-image-pilot-preflight-served.mjs';

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

function mountFor(asset) {
  return {
    assetId: asset.assetId,
    binding: `${asset.merchantId}/${asset.assetId}`,
    generationId: asset.generationId,
    merchantId: asset.merchantId,
    role: asset.role,
    slotId: asset.slot,
    stagedOriginal: asset.stagedOriginal,
  };
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

function _srcSetFor(asset, generationId, format) {
  return asset.tiers
    .filter((tier) => tier.format === format)
    .map((tier) => `/__pilot/${generationId}/${tier.path} ${tier.width}w`)
    .join(', ');
}

describe('preflight served gate', () => {
  it('fetches both arms and verifies descriptors against staged bytes', async () => {
    const fixture = await setupOffline();
    const original = `/__pilot/originals/${MERCHANT}-logo-a.png`;
    const serveFile = async (res, urlPath) => {
      try {
        const bytes = await readFile(join(fixture.publicDir, urlPath));
        res
          .writeHead(200, { 'content-type': 'application/octet-stream' })
          .end(bytes);
      } catch {
        res.writeHead(404).end('missing');
      }
    };
    const pages = {
      '/pilot-lab?arm=pilot': labHtml({ arm: 'pilot', ...fixture }),
      '/pilot-lab?arm=control': `<!doctype html><html><body><main data-pilot-lab-arm="control"><section data-pilot-lab-slot="mobile-hero-slide-0" data-pilot-lab-binding="${MERCHANT}/hero-s0"><link rel="preload" as="image" href="${original}" imageSrcSet="${original}" imageSizes="(max-width: 768px) 40vw, 152px" media="(max-width: 768px)" fetchPriority="high" data-pilot-lab-preload="control" data-pilot-lab-binding="${MERCHANT}/hero-s0"/><picture data-pilot-lab-picture="control"><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${original}" type="image/avif"/><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${original}"/></picture></section><section data-pilot-lab-slot="header-logo" data-pilot-lab-binding="${MERCHANT}/logo-a"><picture data-pilot-lab-picture="control"><source sizes="40px" srcSet="${original}" type="image/avif"/><source sizes="40px" srcSet="${original}" type="image/webp"/></picture></section></main></body></html>`,
    };
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      const body = pages[urlPath];
      if (body) {
        res.writeHead(200, { 'content-type': 'text/html' }).end(body);
        return;
      }
      if (urlPath.startsWith('/__pilot/')) {
        serveFile(res, urlPath).catch(() => res.writeHead(500).end('error'));
        return;
      }
      res.writeHead(404).end('nope');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot', 'control'],
        publicDir: fixture.publicDir,
      });
      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
      expect(
        report.checks.some(
          (check) => check.name === 'served:pilot:response-bytes' && check.ok
        )
      ).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects served image bytes that differ from the staged hashes', async () => {
    const fixture = await setupOffline();
    const html = labHtml({ arm: 'pilot', ...fixture });
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      if (urlPath === '/pilot-lab?arm=pilot') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
        return;
      }
      // Correct HTML, wrong bytes: every image URL 404s.
      res.writeHead(404).end('missing');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        publicDir: fixture.publicDir,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/response-bytes/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects staged-asset redirects even when the target bytes match', async () => {
    const fixture = await setupOffline();
    const html = labHtml({ arm: 'pilot', ...fixture });
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      if (urlPath === '/pilot-lab?arm=pilot') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
        return;
      }
      if (urlPath.startsWith('/__pilot/')) {
        // Same bytes behind a redirect: the topology changed (extra hop,
        // possibly another host), so the gate must fail anyway.
        res.writeHead(302, { location: '/elsewhere/copy.avif' }).end();
        return;
      }
      res.writeHead(404).end('missing');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        publicDir: fixture.publicDir,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/redirected/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

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
          .then((bytes) => res.writeHead(200).end(bytes))
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

  it('rejects descriptor lies and control-arm tier leaks over the wire', async () => {
    const fixture = await setupOffline();
    const good = labHtml({ arm: 'pilot', ...fixture });
    // Lie consistently in link and picture so owner agreement holds while
    // the descriptor no longer matches the decoded staged bytes.
    const lied = good.replaceAll(' 96w', ' 97w');
    const leakedControl = good
      .replaceAll('data-pilot-lab-arm="pilot"', 'data-pilot-lab-arm="control"')
      .replaceAll(
        'data-pilot-lab-preload="pilot"',
        'data-pilot-lab-preload="control"'
      )
      .replaceAll(
        'data-pilot-lab-picture="pilot"',
        'data-pilot-lab-picture="control"'
      );
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      let body = '';
      if (url === '/pilot-lab?arm=pilot') {
        body = lied;
      } else if (url === '/pilot-lab?arm=control') {
        body = leakedControl;
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot', 'control'],
        publicDir: fixture.publicDir,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/descriptor|leak/i);
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

  it('fails unreachable pages before any mount verdict', async () => {
    const report = await fetchServedAgreement('http://unused.invalid', {
      arms: ['pilot'],
      expectedBindings: [],
      expectedMounts: [],
      fetchImpl: () => {
        throw new Error('connection refused');
      },
      publicDir: '/nonexistent',
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/reachable/);
  });

  it('treats loader-param descriptors as existence checks, not width lies', async () => {
    const fixture = await setupOffline();
    const [logo] = fixture.assets;
    const staged = logo.stagedOriginal;
    // Deliberately wrong ?w= descriptors over the real staged file: the
    // original renderers name requested widths, so this must pass.
    const controlHtml = `<!doctype html><html><body><div data-pilot-lab-arm="control"><main><section data-pilot-lab-binding="${MERCHANT}/logo-a" data-pilot-lab-slot="header-logo"><img src="${staged}?w=9999&q=75" srcSet="${staged}?w=9999&q=75 1x" alt="Labstore" width="40" height="40"/></section></main></div></body></html>`;
    const passing = await fetchServedAgreement('http://unused.invalid', {
      arms: ['control'],
      expectedBindings: [`${MERCHANT}/logo-a`],
      expectedMounts: [],
      fetchImpl: async () => controlHtml,
      publicDir: fixture.publicDir,
    });
    expect(passing.failures).toEqual([]);
    expect(passing.ok).toBe(true);
    // Same shape over a missing file: existence still fails closed.
    const missingHtml = controlHtml.replaceAll(
      staged,
      '/__pilot/originals/gone.png'
    );
    const failing = await fetchServedAgreement('http://unused.invalid', {
      arms: ['control'],
      expectedBindings: [`${MERCHANT}/logo-a`],
      expectedMounts: [],
      fetchImpl: async () => missingHtml,
      publicDir: fixture.publicDir,
    });
    expect(failing.ok).toBe(false);
    expect(failing.failures.join('\n')).toMatch(/does not decode/);
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

  it('keeps served check names stable when details contain separators', async () => {
    const fixture = await setupOffline();
    // Width lie: the srcSet claims 999w for a staged 384px tier.
    const html = labHtml({ arm: 'pilot', ...fixture }).replaceAll(
      '384w',
      '999w'
    );
    const report = await fetchServedAgreement('http://unused.invalid', {
      arms: ['pilot'],
      expectedBindings: [`${MERCHANT}/hero-s0`, `${MERCHANT}/logo-a`],
      fetchImpl: async () => html,
      publicDir: fixture.publicDir,
    });
    expect(report.ok).toBe(false);
    // Four width lies (hero/logo x avif/webp): every failing check keeps
    // the bare gate name and every entry carries one prefix.
    const failed = report.checks.filter((check) => !check.ok);
    expect(failed).toHaveLength(4);
    for (const check of failed) {
      expect(check.name).toBe('served:pilot:descriptors');
    }
    expect(report.failures).toHaveLength(4);
    for (const failure of report.failures) {
      expect(failure).toMatch(
        /^served:pilot:descriptors: descriptor 999w does not match decoded width 384: /
      );
    }
  });
});

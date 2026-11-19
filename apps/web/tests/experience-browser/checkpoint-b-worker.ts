import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import {
  type Browser,
  chromium,
  firefox,
  selectors,
  webkit,
} from 'playwright-core';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import { createPreviewVault } from '../../src/lib/experience/preview-service';
import { productionOrigin } from '../../src/lib/experience/production-origins';
import { browserProcessPolicy } from '../../tools/experience-runner/browser-process-policy';
import type { OfflineAsset } from '../../tools/experience-runner/materialize-assets';
import { startPreviewGateway } from '../../tools/experience-runner/preview-gateway';
import {
  collectSemanticNodes,
  semanticEngine,
} from '../../tools/experience-runner/semantic-snapshot';
export async function runCheckpointB(input: {
  engine: 'chromium' | 'firefox' | 'webkit';
  width: number;
  bundle: { javascript: string; css: string; digest: string };
  manifest: ExperienceManifest;
  bootstrap: PublicBootstrap;
  verificationOnly?: boolean;
  semanticCapture?: boolean;
  reducedMotion?: boolean;
  locale?: string;
  hostOrigin?: string;
  assets?: OfflineAsset[];
}) {
  if (input.semanticCapture)
    await selectors.register('baciSemantic', semanticEngine, {
      contentScript: true,
    });
  const phase = (name: string) =>
    process.stderr.write(`QUALIFICATION_PHASE ${name}\n`);
  phase('start');
  let active = true;
  const origin = new URL(input.hostOrigin ?? 'http://127.0.0.1:4100').origin;
  const virtualHttps = new URL(origin).protocol === 'https:';
  if (virtualHttps) productionOrigin(origin);
  const hostPort = virtualHttps ? 4100 : Number(new URL(origin).port);
  const executionOrigin = virtualHttps
    ? 'https://artifacts.baci-offline.invalid'
    : 'http://127.0.0.1:4101';
  assert.ok(hostPort >= 1024 && hostPort <= 65535 && hostPort !== 4101);
  assert.ok(
    virtualHttps ||
      ['localhost', '127.0.0.1'].includes(new URL(origin).hostname)
  );
  const vault = createPreviewVault({
    now: Date.now,
    isActive: async () => active,
    origin: executionOrigin,
  });
  const files = [
    {
      path: 'app.js',
      mime: 'text/javascript',
      bytes: Buffer.from(input.bundle.javascript),
      digest: digestBytes(input.bundle.javascript),
    },
    {
      path: 'app.css',
      mime: 'text/css',
      bytes: Buffer.from(input.bundle.css),
      digest: digestBytes(input.bundle.css),
    },
  ];
  for (const a of input.assets ?? [])
    files.push({
      path: `assets/${a.assetId}`,
      mime: a.mime,
      bytes: Buffer.from(a.bytesBase64, 'base64'),
      digest: a.digest,
    });
  const ref = vault.create({
    ownerId: 'synthetic-owner',
    bindingId: 'synthetic-binding',
    buildDigest: input.bundle.digest,
    files,
  });
  assert.throws(() => vault.consume('other-owner', ref));
  const resources = vault.consume('synthetic-owner', ref);
  assert.throws(() => vault.consume('synthetic-owner', ref));
  const launch = {
    ...resources,
    instanceId: randomUUID(),
    nonce: randomUUID(),
    bootstrap: {
      ...input.bootstrap,
      assets: Object.fromEntries(
        resources.resources
          .filter((f) => f.path.startsWith('assets/'))
          .map((f) => [f.path.slice(7), f.url])
      ),
    },
    routes: input.manifest.routes,
    canonicalBase: `${origin}/qa1`,
  };
  const gateway = await startPreviewGateway(
    vault,
    4101,
    origin,
    virtualHttps ? executionOrigin : undefined
  );
  const host = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'self'; connect-src 'self'; frame-src ${executionOrigin}; style-src 'unsafe-inline'`
    );
    if (req.url === '/host.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(readFileSync('/opt/experience/checkpoint-b-host.js'));
    } else if (req.url === '/launch') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(launch));
    } else if (req.url === '/active') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ active }));
    } else if (req.url?.startsWith('/qa1/')) {
      res.setHeader('Content-Type', 'text/html');
      res.end('<h1>Synthetic canonical destination</h1>');
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/host.js"></script></body></html>'
      );
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      host.once('error', reject);
      host.listen(hostPort, '127.0.0.1', resolve);
    });
  } catch (error) {
    try {
      await gateway.close();
    } catch {
      console.error(
        'Qualification gateway cleanup failed after host bind failure'
      );
    }
    throw error;
  }
  let browser: Browser | undefined;
  try {
    phase('browser-launch');
    browser = await { chromium, firefox, webkit }[input.engine].launch({
      ...browserProcessPolicy(input.engine, process.env),
      headless: true,
      ...(input.engine === 'chromium' ? { chromiumSandbox: true } : {}),
    });
    phase('browser-launched');
    const context = await browser.newContext({
      viewport: { width: input.width, height: 900 },
      reducedMotion: input.reducedMotion ? 'reduce' : 'no-preference',
      locale: input.locale ?? 'en-NG',
    });
    if (virtualHttps) {
      // Exercise actual HTTPS document origins entirely inside the offline sandbox.
      // This verifies origin/CSP behavior, not deployed TLS or network performance.
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const port =
          url.origin === origin
            ? hostPort
            : url.origin === executionOrigin
              ? 4101
              : null;
        if (!port || request.method() !== 'GET') return await route.abort();
        const response = await fetch(
          `http://127.0.0.1:${port}${url.pathname}${url.search}`,
          { redirect: 'error' }
        );
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
      });
    }
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    phase('page-goto');
    await page.goto(origin);
    phase('page-loaded');
    const frame = page.frameLocator('iframe');
    await frame.getByRole('heading', { level: 1 }).first().waitFor();
    phase('frame-ready');
    if (input.verificationOnly) {
      await frame.locator('html').evaluate(async () => {
        await document.fonts.ready;
        if ([...document.fonts].some((f) => f.status === 'error'))
          throw Error('Offline font decode failed');
      });
      if (input.semanticCapture) {
        const child = page
          .frames()
          .find((f) => f.url().startsWith(`${executionOrigin}/`));
        assert.ok(child);
        for (const img of await frame.locator('img').all())
          await img.evaluate((e: HTMLImageElement) => e.decode());
        const box = await frame
          .getByRole('heading', { level: 1 })
          .first()
          .boundingBox();
        assert.ok(box && box.width > 0 && box.height > 0);
        for (const canvas of await frame.locator('canvas').all())
          assert.ok(
            (await canvas.getAttribute('aria-label')) ||
              (await canvas.locator('..').locator('figcaption').count()),
            'Canvas requires semantic alternative'
          );
        assert.deepEqual(errors, []);
        return {
          status: 'passed',
          buildDigest: input.bundle.digest,
          semanticNodes: await (async () => {
            phase('extract');
            const nodes = await collectSemanticNodes(child);
            phase('extracted');
            return nodes;
          })(),
          screenshot: (await page.screenshot({ type: 'png' })).toString(
            'base64'
          ),
        };
      }
      for (const button of await page
        .getByRole('navigation', { name: 'Preview routes' })
        .getByRole('button')
        .all()) {
        await button.click();
        await frame.getByRole('heading', { level: 1 }).first().waitFor();
      }
      for (const img of await frame.getByRole('img').all()) {
        await img.evaluate((e: HTMLImageElement) => e.decode());
        assert.equal(
          await img.evaluate((e: HTMLImageElement) => e.naturalWidth > 0),
          true,
          'Design image did not decode'
        );
      }
      assert.deepEqual(errors, []);
      return {
        status: 'passed',
        buildDigest: input.bundle.digest,
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
      };
    }

    assert.equal(
      await page.locator('iframe').getAttribute('sandbox'),
      'allow-scripts'
    );
    if (await frame.getByRole('button', { name: 'Explore details' }).count())
      await frame.getByRole('button', { name: 'Explore details' }).click();
    phase('cart-add');
    await frame.getByRole('button', { name: 'Add synthetic item' }).click();
    await frame
      .getByRole('status')
      .filter({ hasText: 'Mock bag: 1' })
      .waitFor();
    for (let i = 0; i < 4; i++) {
      phase(`route-${i + 1}-click`);
      await frame.getByRole('navigation').getByRole('button').nth(i).click();
      await frame
        .locator('main > p')
        .filter({
          hasText: new RegExp(
            `\\b${['home', 'collection', 'product', 'editorial'][i]}\\b`
          ),
        })
        .first()
        .waitFor();
      await frame
        .getByRole('status')
        .filter({ hasText: 'Mock bag: 1' })
        .waitFor();
    }
    phase('canonical-link-request');
    await frame
      .getByRole('link', { name: 'Request trusted product link' })
      .click();
    const link = page.getByRole('link', { name: 'Open in new tab' });
    await link.waitFor();
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    phase('new-tab-open');
    const opened = context.waitForEvent('page');
    await link.click();
    const child = await opened;
    await child.waitForLoadState();
    assert.equal(await child.evaluate(() => window.opener), null);
    await child.close();
    await page.getByRole('button', { name: 'Cancel' }).click();
    assert.deepEqual(errors, []);
    const shot = await page.screenshot({ type: 'png' });
    active = false;
    await page.getByRole('alert').waitFor();
    return {
      status: 'passed',
      engine: input.engine,
      width: input.width,
      routes: 4,
      source: 'production SDK + ExperienceFrame + private gateway',
      screenshot: shot.toString('base64'),
      revocation: true,
    };
  } finally {
    phase('browser-close');
    await browser?.close();
    phase('browser-closed');
    host.closeAllConnections();
    await new Promise<void>((resolve) => host.close(() => resolve()));
    phase('host-closed');
    await gateway.close();
    phase('gateway-closed');
    process.stderr.write(
      'QUALIFICATION_RESOURCES ' +
        JSON.stringify(process.getActiveResourcesInfo()) +
        '\n'
    );
  }
}

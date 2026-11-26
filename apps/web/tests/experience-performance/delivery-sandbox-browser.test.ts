import type { PublicBootstrap } from '@baci/shared/experience';
import { chromium, webkit } from 'playwright-core';
import { expect, test } from 'vitest';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import type { createPublicOutputReader } from '../../src/lib/experience/public-output-reader';
import { createProductionPublishedDelivery } from '../../tools/experience-runner/published-delivery';

const hostOrigin = 'https://shop.merchant.test';
const executionOrigin = 'https://output.baci-runtime.test';
const buildDigest = 'a'.repeat(64);
const base = `${executionOrigin}/published/qa1/${buildDigest}/`;
const documentUrl = `${base}index.html?path=%2F`;

const storefrontModule = `
  const root = document.querySelector('#root');
  try {
    document.cookie = 'generated=unexpected; Domain=baci-runtime.test; Secure; Path=/';
    root.dataset.cookie = 'accessible';
  } catch (error) {
    root.dataset.cookie = error.name;
  }
  root.inert = false;
  root.querySelector('button').onclick = () => parent.postMessage('synthetic-cart', '*');
`;

const reader = {
  manifest: () =>
    Promise.resolve({
      merchantId: 'synthetic',
      buildDigest,
      hostOrigin,
      assets: [],
    }),
  read: (_slug: string, _build: string, path: string) => {
    const script = path === 'app.js';
    const bytes = Buffer.from(
      script ? storefrontModule : 'h1{color:rgb(12,34,56)}'
    );
    return Promise.resolve({
      path,
      bytes,
      digest: digestBytes(bytes),
      mime: script ? 'text/javascript' : 'text/css',
    });
  },
};

const deliver = createProductionPublishedDelivery({
  executionOrigin,
  hostOrigin,
  reader: reader as unknown as ReturnType<typeof createPublicOutputReader>,
  render: () =>
    Promise.resolve({
      markup: '<main><h1>Orbit</h1><button>Ink</button></main>',
      bootstrap: {} as PublicBootstrap,
    }),
});

for (const engine of [chromium, webkit]) {
  test(`${engine.name()} isolates direct delivery and keeps embedded storefront interactions`, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.route('**/*', async (route) => {
        const request = route.request();
        if (request.url() === `${hostOrigin}/`) {
          await route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html><body><iframe sandbox="allow-scripts" src="${documentUrl}"></iframe><script>
              addEventListener('message', ({ data, origin, source }) => {
                if (data === 'synthetic-cart' && source === document.querySelector('iframe').contentWindow)
                  document.documentElement.dataset.bridgeOrigin = origin;
              });
            </script></body></html>`,
          });
        } else if (request.url().startsWith(base)) {
          const response = await deliver(new Request(request.url()));
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()),
          });
        } else {
          await route.abort();
        }
      });
      const page = await context.newPage();
      await page.goto(documentUrl);
      await page.locator('#root[data-cookie="SecurityError"]').waitFor();
      expect(
        await page.locator('h1').evaluate((el) => getComputedStyle(el).color)
      ).toBe('rgb(12, 34, 56)');
      expect(await context.cookies('https://events.baci-runtime.test')).toEqual(
        []
      );

      await page.goto(hostOrigin);
      const iframe = page.frameLocator('iframe');
      await iframe.locator('#root[data-cookie="SecurityError"]').waitFor();
      expect(
        await iframe.locator('h1').evaluate((el) => getComputedStyle(el).color)
      ).toBe('rgb(12, 34, 56)');
      await iframe.getByRole('button', { name: 'Ink' }).click();
      await page
        .locator('html[data-bridge-origin="null"]')
        .waitFor({ state: 'attached' });
    } finally {
      await browser.close();
    }
  });
}

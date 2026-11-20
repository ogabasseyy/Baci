import { chromium } from 'playwright-core';
import { createPublicProductPolicy } from '../../tools/experience-verifier/public-product-policy';

/** Captures only the disposable local fixture; no remote resources or order writes. */
export async function captureOrbitSnapshot(dataOrigin: string) {
  const origin = 'http://127.0.0.1:43174';
  const execution = 'http://127.0.0.1:43175';
  const productOrigin = 'https://project.supabase.co';
  const product = createPublicProductPolicy({
    origin: productOrigin,
    merchantId: '11111111-1111-4111-8111-111111111111',
    productId: '33333333-3333-4333-8333-333333333333',
  });
  const permittedWrites = new Set([
    '/api/storefront/experience/launch',
    '/api/storefront/cart/bootstrap',
    '/api/storefront/cart',
    '/api/storefront/cart/commands',
    '/api/storefront/cart/checkout',
  ]);
  const resources = new Map<
    string,
    { status: number; headers: Record<string, string>; bytes: string }
  >();
  const socketFrames: Array<{ binary: boolean; data: string }> = [];
  const pending: Promise<void>[] = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await context.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const syntheticProduct =
        url.origin === dataOrigin &&
        product({
          url: `${productOrigin}${url.pathname}${url.search}`,
          method: req.method(),
        });
      if (
        syntheticProduct ||
        ((url.origin === origin || url.origin === execution) &&
          (req.method() === 'GET' ||
            (req.method() === 'POST' && permittedWrites.has(url.pathname))))
      )
        return route.continue();
      if (
        url.origin === dataOrigin &&
        req.method() === 'OPTIONS' &&
        url.pathname === '/rest/v1/products'
      )
        return route.continue();
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        if (socketFrames.length >= 128) return;
        const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        if (bytes.length > 16777216) return;
        socketFrames.push({
          binary: Buffer.isBuffer(payload),
          data: bytes.toString('base64'),
        });
      });
    });
    page.on('response', (response) => {
      const request = response.request();
      const url = new URL(response.url());
      const isAsset =
        (url.origin === origin || url.origin === execution) &&
        request.method() === 'GET' &&
        (!url.pathname.startsWith('/api/') ||
          url.pathname === '/api/storefront/experience/state' ||
          url.pathname === '/api/storefront/experience/catalog');
      const isLaunch =
        url.origin === origin &&
        request.method() === 'POST' &&
        url.pathname === '/api/storefront/experience/launch';
      if (response.status() !== 200 || (!isAsset && !isLaunch)) return;
      pending.push(
        (async () => {
          const bytes = await response.body();
          if (bytes.length > 16777216)
            throw Error('SNAPSHOT_RESOURCE_TOO_LARGE');
          const headers = await response.allHeaders();
          for (const name of [
            'set-cookie',
            'content-encoding',
            'content-length',
            'transfer-encoding',
            'connection',
          ])
            delete headers[name];
          resources.set(`${request.method()} ${response.url()}`, {
            status: response.status(),
            headers,
            bytes: bytes.toString('base64'),
          });
        })().catch(() => undefined)
      );
    });
    await page.goto(`${origin}/qa1`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const frame = page.frameLocator('iframe');
    await frame
      .locator('html[data-baci-hydration="ready"]')
      .waitFor({ timeout: 60000 });
    await frame
      .getByRole('button', { name: /Add to bag/i })
      .first()
      .click({ timeout: 45000 });
    const bag = frame.getByRole('dialog', { name: 'Shopping bag' });
    await bag.waitFor({ timeout: 45000 });
    const review = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/storefront/cart/checkout' &&
        response.status() === 200,
      { timeout: 45000 }
    );
    await bag
      .getByRole('button', { name: /Review checkout/i })
      .click({ timeout: 45000 });
    await review;
    const checkout = page.getByRole('dialog', { name: 'Continue to checkout' });
    await checkout.waitFor({ timeout: 45000 });
    await checkout
      .getByRole('button', { name: 'Continue to checkout' })
      .waitFor({ timeout: 45000 });
    await Promise.all(pending);
    if (
      !resources.has(`GET ${origin}/qa1`) ||
      ![...resources.keys()].some((key) =>
        key.startsWith(`GET ${execution}/published/`)
      ) ||
      ![...resources.keys()].some((key) =>
        key.startsWith(`POST ${origin}/api/storefront/experience/launch`)
      )
    )
      throw Error('INCOMPLETE_ORBIT_SNAPSHOT');
    return {
      origin,
      dataOrigin,
      productOrigin,
      resources: Object.fromEntries(resources),
      socketFrames,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

/** Controlled local replay; the gVisor job has no network access. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createPublicCartWorkerClient } from '../../tools/experience-runner/public-cart-worker-client';
import { createPublicCommerceEvidence } from '../../tools/experience-runner/public-commerce-evidence';
import { observePublicCommerce } from '../../tools/experience-runner/public-observation-commerce';
import { readPublicObservationStart } from '../../tools/experience-runner/public-observation-start';

type Snapshot = {
  origin: string;
  dataOrigin: string;
  productOrigin: string;
  socketFrames: Array<{ binary: boolean; data: string }>;
  resources: Record<
    string,
    { status: number; headers: Record<string, string>; bytes: string }
  >;
};
const start = await readPublicObservationStart(process.stdin);
if (
  !start ||
  typeof start !== 'object' ||
  !('synthetic' in start) ||
  start.synthetic !== true
)
  throw Error('INVALID_SYNTHETIC_START');
const snapshot = JSON.parse(
  readFileSync('/opt/experience/checkpoint-b-host.js', 'utf8')
) as Snapshot;
const client = createPublicCartWorkerClient({
  input: process.stdin,
  output: process.stdout,
});
let queue: Promise<void> = Promise.resolve();
function relay(request: Parameters<typeof client.request>[0]) {
  const next = queue.then(() => client.request(request));
  queue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}
await client.request({
  url: 'https://qa1.example.test/api/csrf',
  method: 'GET',
});
const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  timeout: 20000,
});
const context = await browser.newContext({ serviceWorkers: 'block' });
await context.routeWebSocket('**/*', (socket) => {
  setTimeout(() => {
    for (const frame of snapshot.socketFrames) {
      const data = Buffer.from(frame.data, 'base64');
      socket.send(frame.binary ? data : data.toString('utf8'));
    }
  }, 100);
});
await context.addCookies([
  {
    name: 'csrf-token',
    value: 'synthetic-browser-token',
    url: `${snapshot.origin}/`,
  },
]);
let blockedOrders = 0;
const commerceEvidence = createPublicCommerceEvidence({
  origin: 'https://qa1.example.test',
  merchantId: '11111111-1111-4111-8111-111111111111',
  productId: '33333333-3333-4333-8333-333333333333',
  paths: ['/'],
});
await context.route('**/*', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.pathname.startsWith('/api/'))
    process.stderr.write(`API ${req.method()} ${url.pathname}\n`);
  if (
    url.pathname.startsWith('/api/orders') ||
    url.pathname.startsWith('/api/payments')
  ) {
    blockedOrders++;
    await route.abort('blockedbyclient');
    return;
  }
  if (
    url.origin === snapshot.dataOrigin &&
    url.pathname === '/rest/v1/products'
  ) {
    if (req.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': snapshot.origin,
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers':
            'apikey, authorization, content-type, x-client-info, accept-profile, x-supabase-api-version',
        },
      });
      return;
    }
    if (req.method() === 'GET') {
      const reply = await relay({
        url: `${snapshot.productOrigin}${url.pathname}${url.search}`,
        method: 'GET',
      });
      await route.fulfill({
        status: reply.status,
        contentType: 'application/json',
        body: reply.body,
        headers: { 'access-control-allow-origin': snapshot.origin },
      });
      return;
    }
  }
  if (
    url.origin === snapshot.origin &&
    [
      '/api/csrf',
      '/api/storefront/cart',
      '/api/storefront/cart/continuity',
      '/api/storefront/cart/bootstrap',
      '/api/storefront/cart/commands',
      '/api/storefront/cart/checkout',
    ].includes(url.pathname) &&
    (req.method() === 'GET' || req.method() === 'POST')
  ) {
    const body = req.postData();
    const request = {
      url: `https://qa1.example.test${url.pathname}${url.search}`,
      method: req.method() as 'GET' | 'POST',
      ...(body === null ? {} : { body }),
    };
    const reply = await relay(request);
    try {
      commerceEvidence.observe(request, reply, 'https://qa1.example.test/');
    } catch (error) {
      const parsed = JSON.parse(reply.body);
      const candidate = parsed.snapshot ?? parsed.cart ?? {};
      process.stderr.write(
        `SYNTHETIC_EVIDENCE_SHAPE ${JSON.stringify({ path: url.pathname, keys: Object.keys(parsed), snapshotKeys: Object.keys(candidate), lineCount: candidate.lines?.length, lineKeys: candidate.lines?.[0] ? Object.keys(candidate.lines[0]) : [], itemKeys: candidate.lines?.[0]?.item ? Object.keys(candidate.lines[0].item) : [], version: candidate.version })}\n`
      );
      throw error;
    }
    await route.fulfill({
      status: reply.status,
      contentType: 'application/json',
      body: reply.body,
    });
    return;
  }
  const resource = snapshot.resources[`${req.method()} ${req.url()}`];
  if (resource) {
    if (url.pathname.includes('/_next/'))
      process.stderr.write(`ASSET ${url.pathname}\n`);
    await route.fulfill({
      status: resource.status,
      headers: resource.headers,
      body: Buffer.from(resource.bytes, 'base64'),
    });
    return;
  }
  process.stderr.write(
    `UNRECORDED ${req.method()} ${url.origin}${url.pathname}\n`
  );
  await route.abort('blockedbyclient');
});
try {
  const page = await context.newPage();
  page.on('pageerror', (error) =>
    process.stderr.write(`PAGE_ERROR ${error.message}\n`)
  );
  page.on('console', (message) => {
    if (message.type() === 'error')
      process.stderr.write(`CONSOLE_ERROR ${message.text().slice(0, 500)}\n`);
  });
  await page.goto(`${snapshot.origin}/qa1`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  const frame = page.frameLocator('iframe');
  try {
    await frame
      .locator('html[data-baci-hydration="ready"]')
      .waitFor({ timeout: 20000 });
  } catch {
    process.stderr.write(
      `PAGE_DIAGNOSTIC ${JSON.stringify({ url: page.url(), frames: page.frames().map((item) => item.url()), scripts: await page.locator('script[src]').count(), body: (await page.locator('body').innerText()).slice(0, 500) })}\n`
    );
    throw Error('ORBIT_FRAME_NOT_READY');
  }
  assert.deepEqual(
    (await observePublicCommerce(page, commerceEvidence)).map(
      (step) => step.action
    ),
    ['cart-add', 'cart-read', 'checkout-review']
  );
  const denied = await page.evaluate(() =>
    fetch('/api/orders', { method: 'POST', body: '{}' }).then(
      () => false,
      () => true
    )
  );
  assert.ok(denied && blockedOrders > 0);
  await context.close();
  await browser.close();
  await client.finish({
    status: 'passed',
    orbit: true,
    checkoutReviewed: true,
    checkoutPresented: true,
    commerceObserved: true,
    orderBlocked: true,
  });
} catch (error) {
  await context.close();
  await browser.close();
  throw error;
}

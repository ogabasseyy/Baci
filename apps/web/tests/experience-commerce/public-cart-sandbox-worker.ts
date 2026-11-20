/** Synthetic qualification only; never installed in the production runner. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { HYDRATION_SELECT } from '@/hooks/cart/shared-cart-products';
import { installPublicCartBrowserRoutes } from '../../tools/experience-runner/public-cart-browser-route';
import { createPublicCartWorkerClient } from '../../tools/experience-runner/public-cart-worker-client';
import { readPublicObservationStart } from '../../tools/experience-runner/public-observation-start';

const origin = 'https://qa1.example.test';
const start = await readPublicObservationStart(process.stdin);
if (
  !start ||
  typeof start !== 'object' ||
  !('synthetic' in start) ||
  start.synthetic !== true
)
  throw Error('INVALID_SYNTHETIC_START');
const product = {
  origin: 'https://project.supabase.co',
  merchantId: '11111111-1111-4111-8111-111111111111',
  productId: '33333333-3333-4333-8333-333333333333',
};
const productUrl = new URL(`${product.origin}/rest/v1/products`);
productUrl.searchParams.set('select', HYDRATION_SELECT.replace(/\s+/g, ''));
productUrl.searchParams.set('merchant_id', `eq.${product.merchantId}`);
productUrl.searchParams.set('id', `in.(${product.productId})`);
productUrl.searchParams.set('status', 'eq.active');
const cart = createPublicCartWorkerClient({
  input: process.stdin,
  output: process.stdout,
});
process.stderr.write('WORKER_START\n');
const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  timeout: 20000,
});
const context = await browser.newContext({ serviceWorkers: 'block' });
process.stderr.write('BROWSER_READY\n');
try {
  const policy = await installPublicCartBrowserRoutes({
    context,
    origin,
    product,
    cart: cart.request,
    resources: [
      {
        url: `${origin}/`,
        mime: 'text/html',
        bytes: Buffer.from('<h1>Synthetic sandbox</h1>'),
        headers: {},
      },
    ],
  });
  process.stderr.write('ROUTES_READY\n');
  const page = await context.newPage();
  await page.goto(`${origin}/`);
  process.stderr.write('PAGE_READY\n');
  const result = await page.evaluate(async (target) => {
    const selected = await fetch(target, {
      headers: {
        apikey: 'synthetic-browser',
        authorization: 'Bearer synthetic-browser',
      },
    }).then((response) => response.json());
    async function post(path: string, body: unknown) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      return response.json();
    }
    await post('/api/storefront/cart/bootstrap', { merchantSlug: 'qa1' });
    const created = await post('/api/storefront/cart', {
      operationId: crypto.randomUUID(),
      lines: [],
    });
    const added = await post('/api/storefront/cart/commands', {
      operationId: crypto.randomUUID(),
      expectedVersion: created.cart.version,
      command: {
        type: 'add',
        item: { productId: '33333333-3333-4333-8333-333333333333' },
        quantity: 1,
      },
    });
    const review = await post('/api/storefront/cart/checkout', {
      operationId: crypto.randomUUID(),
      expectedVersion: added.cart.version,
      cartId: created.cart.cartId,
    });
    const blocked = await fetch('/api/orders', {
      method: 'POST',
      body: '{}',
    }).then(
      () => false,
      () => true
    );
    return {
      count: added.cart.lines.length,
      reviewed: !!review.snapshot,
      blocked,
      selected: selected[0]?.id,
    };
  }, productUrl.href);
  assert.deepEqual(result, {
    count: 1,
    reviewed: true,
    blocked: true,
    selected: product.productId,
  });
  assert.ok(policy.blocked() > 0);
  await context.close();
  await browser.close();
  process.stderr.write('BROWSER_CLOSED\n');
  await cart.finish({ status: 'passed', cart: true, orderBlocked: true });
} catch (error) {
  await context.close();
  await browser.close();
  throw error;
}

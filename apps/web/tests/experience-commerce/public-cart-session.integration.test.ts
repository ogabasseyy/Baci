import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';
import { installPublicCartBrowserRoutes } from '../../tools/experience-runner/public-cart-browser-route';
import { runPublicCartChannel } from '../../tools/experience-runner/public-cart-channel';
import { createPublicCartWorkerClient } from '../../tools/experience-runner/public-cart-worker-client';
import { createPublicCartSession } from '../../tools/experience-verifier/public-cart-session';

// Run only while the operator-owned serve-local synthetic fixture is running.
// This adapter maps the HTTPS storefront origin to loopback and adds Secure to
// development cookies; it does not qualify the production HTTPS transport.
const merchantId = '11111111-1111-4111-8111-111111111111';
const productId = '33333333-3333-4333-8333-333333333333';
const origin = 'https://qa1.example.test';
function localSession(paths: string[]) {
  return createPublicCartSession({
    origin,
    merchantId,
    merchantSlug: 'qa1',
    productId,
    network: async (request) => {
      const path = new URL(request.url).pathname;
      paths.push(path);
      const headers: Record<string, string> = {
        ...request.headers,
        host: 'qa1.localhost:43174',
      };
      if (headers.origin) headers.origin = 'http://qa1.localhost:43174';
      const response = await fetch(`http://qa1.localhost:43174${path}`, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
      });
      return {
        status: response.status,
        body: Buffer.from(await response.arrayBuffer()),
        cookies: response.headers
          .getSetCookie()
          .map((cookie) => `${cookie}; Secure`),
      };
    },
  });
}
it.skipIf(process.env.BACI_LOCAL_CART_SESSION_TEST !== '1')(
  'reviews the real synthetic cart through Baci routes without an order request',
  async () => {
    const paths: string[] = [];
    const session = localSession(paths);
    const get = (path: string) =>
      session({ url: `${origin}${path}`, method: 'GET' });
    const post = (path: string, body: unknown) =>
      session({
        url: `${origin}${path}`,
        method: 'POST',
        body: JSON.stringify(body),
      });
    await get('/api/csrf');
    expect((await get('/api/storefront/cart')).status).toBe(204);
    await post('/api/storefront/cart/bootstrap', { merchantSlug: 'qa1' });
    const created = JSON.parse(
      (
        await post('/api/storefront/cart', {
          operationId: randomUUID(),
          lines: [],
        })
      ).body
    );
    const cartId = created.cart.cartId;
    expect(cartId).toBeTypeOf('string');
    const added = JSON.parse(
      (
        await post('/api/storefront/cart/commands', {
          operationId: randomUUID(),
          expectedVersion: created.cart.version,
          command: { type: 'add', item: { productId }, quantity: 1 },
        })
      ).body
    );
    expect(added.cart.lines).toHaveLength(1);
    const review = JSON.parse(
      (
        await post('/api/storefront/cart/checkout', {
          operationId: randomUUID(),
          expectedVersion: added.cart.version,
          cartId,
        })
      ).body
    );
    expect(review).toHaveProperty('snapshot');
    expect(paths).toEqual([
      '/api/csrf',
      '/api/storefront/cart',
      '/api/storefront/cart/bootstrap',
      '/api/storefront/cart',
      '/api/storefront/cart/commands',
      '/api/storefront/cart/checkout',
    ]);
  },
  60000
);

it.skipIf(process.env.BACI_LOCAL_CART_SESSION_TEST !== '1')(
  'uses real Chromium and the bounded channel to review the synthetic Baci cart',
  async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const toHost = new PassThrough();
    const toWorker = new PassThrough();
    const paths: string[] = [];
    const host = runPublicCartChannel({
      input: toHost,
      output: toWorker,
      session: localSession(paths),
    });
    const worker = createPublicCartWorkerClient({
      input: toWorker,
      output: toHost,
    });
    try {
      const policy = await installPublicCartBrowserRoutes({
        context,
        origin,
        cart: worker.request,
        resources: [
          {
            url: `${origin}/`,
            mime: 'text/html',
            bytes: Buffer.from('<h1>Synthetic storefront test</h1>'),
            headers: {},
          },
        ],
      });
      const page = await context.newPage();
      await page.goto(`${origin}/`);
      const result = await page.evaluate(
        async ({ selected }) => {
          async function post(path: string, body: unknown) {
            const response = await fetch(path, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
              item: { productId: selected },
              quantity: 1,
            },
          });
          const review = await post('/api/storefront/cart/checkout', {
            operationId: crypto.randomUUID(),
            expectedVersion: added.cart.version,
            cartId: created.cart.cartId,
          });
          const orderBlocked = await fetch('/api/orders', {
            method: 'POST',
            body: '{}',
          }).then(
            () => false,
            () => true
          );
          return {
            count: added.cart.lines.length,
            reviewed: !!review.snapshot,
            orderBlocked,
          };
        },
        { selected: productId }
      );
      expect(result).toEqual({ count: 1, reviewed: true, orderBlocked: true });
      expect(policy.blocked()).toBeGreaterThan(0);
      await worker.finish({ status: 'synthetic' });
      await expect(host).resolves.toEqual({ status: 'synthetic' });
      expect(paths).toEqual([
        '/api/csrf',
        '/api/storefront/cart/bootstrap',
        '/api/storefront/cart',
        '/api/storefront/cart/commands',
        '/api/storefront/cart/checkout',
      ]);
    } finally {
      await context.close();
      await browser.close();
      toHost.destroy();
      toWorker.destroy();
    }
  },
  60000
);

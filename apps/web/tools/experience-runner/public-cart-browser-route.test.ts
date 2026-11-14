import { PassThrough } from 'node:stream';
import { chromium } from 'playwright-core';
import { expect, it, vi } from 'vitest';
import { HYDRATION_SELECT } from '@/hooks/cart/shared-cart-products';
import { createPublicCartSession } from '../experience-verifier/public-cart-session';
import { installPublicCartBrowserRoutes } from './public-cart-browser-route';
import { runPublicCartChannel } from './public-cart-channel';
import { createPublicCartWorkerClient } from './public-cart-worker-client';

it('loads a dynamic framework chunk through the scoped host relay and blocks foreign chunks', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const origin = 'https://shop.example.com';
  const cart = vi.fn(async (request: { url: string }) =>
    request.url.endsWith('/api/csrf')
      ? { status: 200, body: '{}' }
      : {
          status: 200,
          body: JSON.stringify({
            mime: 'text/javascript',
            bytes: Buffer.from('window.dynamicChunk = 42').toString('base64'),
          }),
        }
  );
  try {
    await installPublicCartBrowserRoutes({
      context,
      origin,
      cart,
      resources: [
        {
          url: `${origin}/`,
          mime: 'text/html',
          bytes: Buffer.from('<h1>Store</h1>'),
          headers: {},
        },
      ],
    });
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    const result = await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/_next/static/chunks/lazy.js';
        script.onload = () => resolve();
        script.onerror = () => reject(Error('script failed'));
        document.head.append(script);
      });
      const foreign = await fetch(
        'https://other.example/_next/static/a.js'
      ).then(
        () => false,
        () => true
      );
      return { loaded: Reflect.get(window, 'dynamicChunk'), foreign };
    });
    expect(result).toEqual({
      loaded: 42,
      foreign: true,
    });
    expect(cart).toHaveBeenCalledTimes(2);
  } finally {
    await context.close();
    await browser.close();
  }
}, 30000);

it('uses the host channel for cart requests and blocks an order from a real browser', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const cart = vi.fn(
    async (request: { url: string; method: string; body?: string }) => {
      if (request.url.endsWith('/api/csrf')) return { status: 200, body: '{}' };
      if (request.url.endsWith('/api/storefront/cart'))
        return { status: 200, body: '{"cart":{"items":1}}' };
      if (request.url.endsWith('/api/storefront/experience/state?path=%2F'))
        return { status: 200, body: '{"active":true}' };
      if (
        request.url.endsWith(
          '/api/storefront/experience/catalog?merchantSlug=synthetic'
        )
      )
        return { status: 200, body: '{"products":[]}' };
      if (request.url.endsWith('/api/storefront/experience/launch?path=%2F'))
        return { status: 200, body: '{"renewed":true}' };
      throw Error('forbidden');
    }
  );
  try {
    const policy = await installPublicCartBrowserRoutes({
      context,
      origin: 'https://shop.example.com',
      resources: [
        {
          url: 'https://shop.example.com/',
          mime: 'text/html',
          bytes: Buffer.from('<h1>Synthetic shop</h1>'),
          headers: {},
        },
      ],
      cart,
    });
    const page = await context.newPage();
    await page.goto('https://shop.example.com/');
    const result = await page.evaluate(async () => {
      const cartResult = await fetch('/api/storefront/cart').then((response) =>
        response.json()
      );
      const state = await fetch(
        '/api/storefront/experience/state?path=%2F'
      ).then((response) => response.json());
      const launch = await fetch('/api/storefront/experience/launch?path=%2F', {
        method: 'POST',
        body: '{}',
      }).then((response) => response.json());
      const catalog = await fetch(
        '/api/storefront/experience/catalog?merchantSlug=synthetic'
      ).then((response) => response.json());
      const order = await fetch('/api/orders', {
        method: 'POST',
        body: '{}',
      }).then(
        () => 'allowed',
        () => 'blocked'
      );
      return { cartResult, state, launch, catalog, order };
    });
    expect(result).toEqual({
      cartResult: { cart: { items: 1 } },
      state: { active: true },
      launch: { renewed: true },
      catalog: { products: [] },
      order: 'blocked',
    });
    expect(cart.mock.calls.map(([request]) => request.url)).toEqual([
      'https://shop.example.com/api/csrf',
      'https://shop.example.com/api/storefront/cart',
      'https://shop.example.com/api/storefront/experience/state?path=%2F',
      'https://shop.example.com/api/storefront/experience/launch?path=%2F',
      'https://shop.example.com/api/storefront/experience/catalog?merchantSlug=synthetic',
    ]);
    expect(policy.blocked()).toBeGreaterThan(0);
  } finally {
    await context.close();
    await browser.close();
  }
}, 30000);

it('allows only the bound anonymous product query across browser origins', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const origin = 'https://shop.example.com';
  const product = {
    origin: 'https://project.supabase.co',
    merchantId: '10000000-0000-4000-8000-000000000001',
    productId: '20000000-0000-4000-8000-000000000002',
  };
  const url = new URL(`${product.origin}/rest/v1/products`);
  url.searchParams.set('select', HYDRATION_SELECT.replace(/\s+/g, ''));
  url.searchParams.set('merchant_id', `eq.${product.merchantId}`);
  url.searchParams.set('id', `in.(${product.productId})`);
  url.searchParams.set('status', 'eq.active');
  const relay = vi.fn(async (request: { url: string }) => ({
    status: 200,
    body: request.url === url.href ? '[]' : '{}',
  }));
  try {
    await installPublicCartBrowserRoutes({
      context,
      origin,
      product,
      cart: relay,
      resources: [
        {
          url: `${origin}/`,
          mime: 'text/html',
          bytes: Buffer.from('<h1>Synthetic</h1>'),
          headers: {},
        },
      ],
    });
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    const result = await page.evaluate(async (target) => {
      const response = await fetch(target, {
        headers: {
          apikey: 'browser-value',
          authorization: 'Bearer browser-value',
        },
      });
      const denied = await fetch(target.replace('/products?', '/orders?')).then(
        () => false,
        () => true
      );
      return { status: response.status, body: await response.json(), denied };
    }, url.href);
    expect(result).toEqual({ status: 200, body: [], denied: true });
    expect(relay.mock.calls.map(([request]) => request.url)).toEqual([
      `${origin}/api/csrf`,
      url.href,
    ]);
  } finally {
    await context.close();
    await browser.close();
  }
}, 30000);

it('passes real browser requests through both sides of the bounded channel', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const toHost = new PassThrough();
  const toWorker = new PassThrough();
  const network = vi.fn(async (request: { url: string }) => ({
    status: 200,
    body: Buffer.from(
      request.url.endsWith('/api/csrf') ? '{}' : '{"cart":{"items":1}}'
    ),
    cookies: request.url.endsWith('/api/csrf')
      ? [`__Host-csrf-token=${'x'.repeat(43)}; Path=/; Secure`]
      : [],
  }));
  const session = createPublicCartSession({
    origin: 'https://shop.example.com',
    merchantSlug: 'synthetic',
    merchantId: '10000000-0000-4000-8000-000000000001',
    productId: '20000000-0000-4000-8000-000000000002',
    network,
  });
  const host = runPublicCartChannel({
    input: toHost,
    output: toWorker,
    session,
  });
  const worker = createPublicCartWorkerClient({
    input: toWorker,
    output: toHost,
  });
  try {
    await installPublicCartBrowserRoutes({
      context,
      origin: 'https://shop.example.com',
      cart: worker.request,
      resources: [
        {
          url: 'https://shop.example.com/',
          mime: 'text/html',
          bytes: Buffer.from('<h1>Synthetic</h1>'),
          headers: {},
        },
      ],
    });
    const page = await context.newPage();
    await page.goto('https://shop.example.com/');
    await expect(
      page.evaluate(() =>
        fetch('/api/storefront/cart').then((response) => response.json())
      )
    ).resolves.toEqual({ cart: { items: 1 } });
    await worker.finish({ status: 'synthetic' });
    await expect(host).resolves.toEqual({ status: 'synthetic' });
    expect(network).toHaveBeenCalledTimes(2);
  } finally {
    await context.close();
    await browser.close();
  }
}, 30000);

it('serializes concurrent browser requests before using the single-flight host channel', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const toHost = new PassThrough();
  const toWorker = new PassThrough();
  const session = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { status: 200, body: '{"ok":true}' };
  });
  const host = runPublicCartChannel({
    input: toHost,
    output: toWorker,
    session,
  });
  const worker = createPublicCartWorkerClient({
    input: toWorker,
    output: toHost,
  });
  try {
    await installPublicCartBrowserRoutes({
      context,
      origin: 'https://shop.example.com',
      cart: worker.request,
      resources: [
        {
          url: 'https://shop.example.com/',
          mime: 'text/html',
          bytes: Buffer.from('<h1>Synthetic</h1>'),
          headers: {},
        },
      ],
    });
    const page = await context.newPage();
    await page.goto('https://shop.example.com/');
    await expect(
      page.evaluate(async () =>
        Promise.all([
          fetch('/api/storefront/cart').then((r) => r.json()),
          fetch('/api/storefront/experience/state').then((r) => r.json()),
          fetch('/api/storefront/cart/continuity').then((r) => r.json()),
        ])
      )
    ).resolves.toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    await worker.finish({ status: 'synthetic' });
    await expect(host).resolves.toEqual({ status: 'synthetic' });
    expect(session).toHaveBeenCalledTimes(4);
  } finally {
    await context.close();
    await browser.close();
  }
}, 30000);

it('fails closed after a host relay failure', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const cart = vi.fn(async (request: { url: string }) => {
    if (request.url.endsWith('/api/csrf')) return { status: 200, body: '{}' };
    throw Error('host unavailable');
  });
  try {
    await installPublicCartBrowserRoutes({
      context,
      origin: 'https://shop.example.com',
      cart,
      resources: [
        {
          url: 'https://shop.example.com/',
          mime: 'text/html',
          bytes: Buffer.from('<h1>Synthetic</h1>'),
          headers: {},
        },
      ],
    });
    const page = await context.newPage();
    await page.goto('https://shop.example.com/');
    const outcomes = await page.evaluate(async () => {
      const first = await fetch('/api/storefront/cart').then(
        () => true,
        () => false
      );
      const second = await fetch('/api/storefront/cart/continuity').then(
        () => true,
        () => false
      );
      return [first, second];
    });
    expect(outcomes).toEqual([false, false]);
    expect(cart).toHaveBeenCalledTimes(2);
  } finally {
    await context.close();
    await browser.close();
  }
}, 30000);

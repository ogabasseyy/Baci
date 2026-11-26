import { type BrowserContext, chromium } from 'playwright-core';
import { expect, it, vi } from 'vitest';
import { HYDRATION_SELECT } from '@/hooks/cart/shared-cart-products';
import { installPublicCartBrowserRoutes } from './public-cart-browser-route';
import { MAX_PUBLIC_OBSERVATION_RESOURCES } from './public-observation-resource-limit';

it('installs the full verifier resource set and rejects anything over the shared limit', async () => {
  const origin = 'https://shop.example.com';
  const addCookies = vi.fn();
  const route = vi.fn();
  const cart = vi.fn(async () => ({ status: 200, body: '{}' }));
  const context = { addCookies, route } as unknown as BrowserContext;
  const resources = Array.from(
    { length: MAX_PUBLIC_OBSERVATION_RESOURCES + 1 },
    (_, index) => ({
      url: `${origin}/observation/${index}`,
      mime: 'text/html',
      bytes: Buffer.from('<h1>Synthetic storefront</h1>'),
      headers: {},
    })
  );

  await expect(
    installPublicCartBrowserRoutes({ context, origin, resources, cart })
  ).rejects.toThrow('INVALID_BROWSER_RESOURCES');
  expect(cart).not.toHaveBeenCalled();
  expect(route).not.toHaveBeenCalled();
  await installPublicCartBrowserRoutes({
    context,
    origin,
    resources: resources.slice(0, MAX_PUBLIC_OBSERVATION_RESOURCES),
    cart,
  });
  expect(cart).toHaveBeenCalledOnce();
  expect(route).toHaveBeenCalledOnce();
});

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

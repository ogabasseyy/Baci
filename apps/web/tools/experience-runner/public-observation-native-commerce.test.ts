import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';
import { createPublicCartPolicy } from '../experience-verifier/public-cart-policy';
import { observePublicBrowser } from './public-observation-browser';
import {
  fixture,
  origin,
  productId,
  syntheticCart,
  syntheticCheckout,
} from './public-observation-fixture.test-support';

it.each([
  '/',
  '/pages/story',
])('verifies custom coverage at %s and prepares checkout from the native PDP', async (path) => {
  const browser = await chromium.launch({ headless: true });
  const check = createPublicCartPolicy({
    origin,
    merchantSlug: 'synthetic',
    productId,
  });
  const standard = fixture();
  const product = standard.expected.product;
  const productCanonical = `${origin}${product.path}`;
  const resources = standard.resources
    .filter(
      (item) => !item.url.includes(`?path=${encodeURIComponent(product.path)}`)
    )
    .map((item) =>
      item.url === productCanonical
        ? {
            ...item,
            bytes: Buffer.from(
              `<title>Native device</title><link rel="canonical" href="${productCanonical}"><h1>Device</h1>`
            ).toString('base64'),
          }
        : item.url === `${origin}/`
          ? {
              ...item,
              url: `${origin}${path}`,
              bytes: Buffer.from(
                Buffer.from(item.bytes, 'base64')
                  .toString()
                  .replace(`href="${origin}/"`, `href="${origin}${path}"`)
                  .replace('?path=%2F"', `?path=${encodeURIComponent(path)}"`)
              ).toString('base64'),
            }
          : item.url.endsWith('?path=%2F')
            ? {
                ...item,
                url: item.url.replace(/%2F$/, encodeURIComponent(path)),
              }
            : item
    );
  const payload = {
    ...standard,
    resources,
    expected: {
      ...standard.expected,
      product: { ...product, native: true },
      routes: [
        { ...standard.expected.routes[0], path, canonical: `${origin}${path}` },
      ],
    },
  };
  const called: string[] = [];
  try {
    const result = await observePublicBrowser(
      payload,
      browser,
      async (request) => {
        if (!check(request)) throw Error('DENIED');
        const endpoint = new URL(request.url).pathname;
        called.push(`${request.method} ${endpoint}`);
        return {
          status: 200,
          body: JSON.stringify(
            endpoint.endsWith('/checkout')
              ? { snapshot: syntheticCheckout }
              : { cart: syntheticCart }
          ),
        };
      }
    );
    expect(result.routes.map((route) => route.path)).toEqual([path]);
    expect(
      result.journey.steps.map((step) => [step.action, step.path])
    ).toEqual([
      ['navigate', path],
      ['product', product.path],
      ['cart-add', product.path],
      ['cart-read', product.path],
      ['checkout-review', product.path],
    ]);
    expect(called).toEqual([
      'GET /api/csrf',
      'POST /api/storefront/cart/bootstrap',
      'POST /api/storefront/cart',
      'POST /api/storefront/cart/commands',
      'GET /api/storefront/cart',
      'POST /api/storefront/cart/checkout',
    ]);
    expect(result.journey.orderRequests).toBe(0);
    expect(result.journey.paymentRequests).toBe(0);
  } finally {
    await browser.close();
  }
}, 30000);

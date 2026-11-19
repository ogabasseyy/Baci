import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';
import { createPublicCartPolicy } from '../experience-verifier/public-cart-policy';
import { observePublicBrowser } from './public-observation-browser';

import {
  cartId,
  fixture,
  merchantId,
  origin,
  productId,
} from './public-observation-fixture.test-support';

it('combines rendered routes and synthetic commerce with 32 verified assets', async () => {
  const browser = await chromium.launch({ headless: true });
  const check = createPublicCartPolicy({
    origin,
    merchantSlug: 'synthetic',
    productId,
  });
  const cart = {
    cartId,
    merchantId,
    version: 1,
    lines: [{ item: { productId }, quantity: 1 }],
  };
  const checkout = {
    cartId,
    merchantId,
    cartVersion: 1,
    checkoutSessionId: '55555555-5555-4555-8555-555555555555',
    lines: [{ productId, variantId: null, quantity: 1, available: true }],
  };
  const payload = fixture();
  const bytes = Buffer.alloc(256 * 1024);
  const encoded = bytes.toString('base64');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const logo = payload.resources[2];
  const extraAssets = Object.fromEntries(
    Array.from({ length: 31 }, (_, index) => [`asset-${index}`, digest])
  );
  payload.expected.assets = { logo: digest, ...extraAssets };
  logo.bytes = encoded;
  payload.resources.push(
    ...Object.keys(extraAssets).map((id) => ({
      ...logo,
      url: logo.url.replace(/logo$/, id),
    }))
  );
  try {
    const result = await observePublicBrowser(
      payload,
      browser,
      async (request) => {
        if (!check(request)) throw Error('DENIED');
        if (request.url.endsWith('/api/csrf'))
          return { status: 200, body: '{}' };
        return {
          status: 200,
          body: JSON.stringify(
            request.url.endsWith('/checkout')
              ? { snapshot: checkout }
              : { cart }
          ),
        };
      }
    );
    expect(result.routes.map((route) => route.path)).toEqual([
      '/',
      '/products/device',
    ]);
    expect(result.journey.steps.map((step) => step.action)).toEqual([
      'navigate',
      'product',
      'cart-add',
      'cart-read',
      'checkout-review',
    ]);
    expect(result.journey.orderRequests).toBe(0);
  } finally {
    await browser.close();
  }
}, 30000);

it('rejects altered output before opening a browser', async () => {
  const payload = fixture();
  payload.resources[0].bytes = Buffer.from('changed').toString('base64');
  await expect(
    observePublicBrowser(payload, {} as never, async () => ({
      status: 200,
      body: '{}',
    }))
  ).rejects.toThrow('PUBLIC_OUTPUT_MISMATCH');
});

it('rejects an attempted order while keeping the request blocked', async () => {
  const browser = await chromium.launch({ headless: true });
  const check = createPublicCartPolicy({
    origin,
    merchantSlug: 'synthetic',
    productId,
  });
  const cart = {
    cartId,
    merchantId,
    version: 1,
    lines: [{ item: { productId }, quantity: 1 }],
  };
  const checkout = {
    cartId,
    merchantId,
    cartVersion: 1,
    checkoutSessionId: '55555555-5555-4555-8555-555555555555',
    lines: [{ productId, variantId: null, quantity: 1, available: true }],
  };
  let orderForwarded = false;
  try {
    await expect(
      observePublicBrowser(
        fixture({ tryOrder: true }),
        browser,
        async (request) => {
          if (request.url.includes('/orders')) orderForwarded = true;
          if (!check(request)) throw Error('DENIED');
          if (request.url.endsWith('/api/csrf'))
            return { status: 200, body: '{}' };
          return {
            status: 200,
            body: JSON.stringify(
              request.url.endsWith('/checkout')
                ? { snapshot: checkout }
                : { cart }
            ),
          };
        }
      )
    ).rejects.toThrow('PUBLIC_OBSERVATION_INCOMPLETE');
    expect(orderForwarded).toBe(false);
  } finally {
    await browser.close();
  }
}, 30000);

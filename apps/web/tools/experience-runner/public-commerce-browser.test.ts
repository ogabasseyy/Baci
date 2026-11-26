import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';
import { createPublicCartPolicy } from '../experience-verifier/public-cart-policy';
import { installPublicCartBrowserRoutes } from './public-cart-browser-route';
import { createPublicCommerceEvidence } from './public-commerce-evidence';

it('derives ordered commerce evidence from a real browser and authorized synthetic responses', async () => {
  const origin = 'https://shop.example.com';
  const merchantId = '11111111-1111-4111-8111-111111111111';
  const productId = '33333333-3333-4333-8333-333333333333';
  const cartId = '44444444-4444-4444-8444-444444444444';
  const snapshot = {
    cartId,
    merchantId,
    version: 1,
    lines: [{ item: { productId }, quantity: 1 }],
  };
  const check = createPublicCartPolicy({
    origin,
    merchantSlug: 'synthetic',
    productId,
  });
  const ledger = createPublicCommerceEvidence({
    origin,
    merchantId,
    productId,
    paths: ['/products/device'],
  });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const markup = `<button id="add">Add to bag</button><button id="read">Read bag</button><button id="review">Review checkout</button><script>
      document.querySelector('#add').onclick = () => fetch('/api/storefront/cart/commands', { method:'POST', body: JSON.stringify({operationId:'add',expectedVersion:1,command:{type:'add',item:{productId:'${productId}'},quantity:1}}) });
      document.querySelector('#read').onclick = () => fetch('/api/storefront/cart');
      document.querySelector('#review').onclick = () => fetch('/api/storefront/cart/checkout', { method:'POST', body: JSON.stringify({operationId:'review',expectedVersion:1,cartId:'${cartId}'}) });
    </script>`;
    await installPublicCartBrowserRoutes({
      context,
      origin,
      resources: [
        {
          url: `${origin}/products/device`,
          mime: 'text/html',
          bytes: Buffer.from(markup),
          headers: {},
        },
      ],
      cart: async (request) => {
        if (!check(request)) throw Error('DENIED');
        if (request.url.endsWith('/api/csrf'))
          return { status: 200, body: '{}' };
        return {
          status: 200,
          body: JSON.stringify(
            request.url.endsWith('/checkout')
              ? {
                  snapshot: {
                    cartId,
                    merchantId,
                    cartVersion: 1,
                    checkoutSessionId: '55555555-5555-4555-8555-555555555555',
                    lines: [
                      {
                        productId,
                        variantId: null,
                        quantity: 1,
                        available: true,
                      },
                    ],
                  },
                }
              : { cart: snapshot }
          ),
        };
      },
      observeCommerce: ledger.observe,
    });
    const page = await context.newPage();
    await page.goto(`${origin}/products/device`);
    for (const [name, path] of [
      ['Add to bag', '/commands'],
      ['Read bag', '/cart'],
      ['Review checkout', '/checkout'],
    ]) {
      const response = page.waitForResponse((r) =>
        new URL(r.url()).pathname.endsWith(path)
      );
      await page.getByRole('button', { name }).click();
      await response;
    }
    expect(ledger.complete().map((step) => step.action)).toEqual([
      'cart-add',
      'cart-read',
      'checkout-review',
    ]);
  } finally {
    await context.close();
    await browser.close();
  }
}, 30000);

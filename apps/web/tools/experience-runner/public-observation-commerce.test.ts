import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';
import { createPublicCartPolicy } from '../experience-verifier/public-cart-policy';
import { installPublicCartBrowserRoutes } from './public-cart-browser-route';
import { createPublicCommerceEvidence } from './public-commerce-evidence';
import { observePublicCommerce } from './public-observation-commerce';

it.each([
  [
    'English labels',
    "<button onclick=\"parent.postMessage('add','*')\">Add to bag</button><button onclick=\"parent.postMessage('review','*')\">Review checkout</button>",
  ],
  [
    'localized annotated labels',
    '<button data-baci-commerce="add" onclick="parent.postMessage(\'add\',\'*\')">Ajouter au panier</button><button data-baci-commerce="checkout" onclick="parent.postMessage(\'review\',\'*\')">Commander</button>',
  ],
])(
  'clicks custom frame %s and requires real authorized cart and checkout responses',
  async (_description, controls) => {
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
    const checkout = {
      cartId,
      merchantId,
      cartVersion: 1,
      checkoutSessionId: '55555555-5555-4555-8555-555555555555',
      lines: [{ productId, variantId: null, quantity: 1, available: true }],
    };
    const policy = createPublicCartPolicy({
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
      const parent = `<iframe data-baci-experience-build="${'a'.repeat(64)}" sandbox="allow-scripts" src="${origin}/frame"></iframe><script>
    addEventListener('message', async (event) => {
      if (event.data === 'add') { await fetch('/api/storefront/cart/commands', { method:'POST', body: JSON.stringify({operationId:'add',expectedVersion:1,command:{type:'add',item:{productId:'${productId}'},quantity:1}}) }); await fetch('/api/storefront/cart'); }
      if (event.data === 'review') { await fetch('/api/storefront/cart/checkout', {method:'POST',body:JSON.stringify({operationId:'review',expectedVersion:1,cartId:'${cartId}'})}); document.body.insertAdjacentHTML('beforeend','<div role="dialog" aria-label="Continue to checkout"><button>Continue to checkout</button></div>'); }
    });</script>`;
      const frame = `<html data-baci-hydration="ready">${controls}</html>`;
      await installPublicCartBrowserRoutes({
        context,
        origin,
        resources: [
          {
            url: `${origin}/products/device`,
            mime: 'text/html',
            bytes: Buffer.from(parent),
            headers: {},
          },
          {
            url: `${origin}/frame`,
            mime: 'text/html',
            bytes: Buffer.from(frame),
            headers: {},
          },
        ],
        cart: async (request) => {
          if (!policy(request)) throw Error('DENIED');
          if (request.url.endsWith('/api/csrf'))
            return { status: 200, body: '{}' };
          return {
            status: 200,
            body: JSON.stringify(
              request.url.endsWith('/checkout')
                ? { snapshot: checkout }
                : { cart: snapshot }
            ),
          };
        },
        observeCommerce: ledger.observe,
      });
      const page = await context.newPage();
      await page.goto(`${origin}/products/device`);
      const result = await observePublicCommerce(page, ledger, {
        timeoutMs: 3000,
      });
      expect(result.map((step) => step.action)).toEqual([
        'cart-add',
        'cart-read',
        'checkout-review',
      ]);
    } finally {
      await context.close();
      await browser.close();
    }
  },
  15000
);

it('rejects a storefront that displays success without making cart requests', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const origin = 'https://shop.example.com';
  try {
    await context.route('**/*', async (route) => {
      const html = route.request().url().endsWith('/frame')
        ? '<html data-baci-hydration="ready"><button>Add to bag</button><p>Success</p></html>'
        : `<iframe data-baci-experience-build="${'a'.repeat(64)}" sandbox="allow-scripts" src="${origin}/frame"></iframe>`;
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: html,
      });
    });
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    const ledger = createPublicCommerceEvidence({
      origin,
      merchantId: '11111111-1111-4111-8111-111111111111',
      productId: '33333333-3333-4333-8333-333333333333',
      paths: ['/'],
    });
    await expect(
      observePublicCommerce(page, ledger, { timeoutMs: 1000 })
    ).rejects.toThrow();
    expect(() => ledger.complete()).toThrow();
  } finally {
    await context.close();
    await browser.close();
  }
}, 10000);

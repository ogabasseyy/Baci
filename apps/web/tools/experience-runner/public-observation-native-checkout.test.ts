import { chromium } from 'playwright-core';
import { expect, it, vi } from 'vitest';
import { getStorefrontCartStorageKey } from '@/hooks/cart/cart-storage';
import { observePublicBrowser } from './public-observation-browser';
import {
  fixture,
  origin,
  productId,
} from './public-observation-fixture.test-support';

it('observes native guest checkout through the isolated browser without Shared Cart', async () => {
  const browser = await chromium.launch({ headless: true });
  const payload = fixture();
  const product = payload.expected.product;
  const variantId = '33333333-3333-4333-8333-333333333334';
  const storageKey = getStorefrontCartStorageKey('synthetic');
  const body = {
    [product.path]: `<title>Native device</title><link rel="canonical" href="${origin}${product.path}">
      <button data-ogabassey-pdp-commerce-variant-option onclick="this.dataset.selected = 'true'">Blue</button>
      <button id="add">Add to cart</button>
      <script>
        localStorage.setItem("${storageKey}", "[]");
        setTimeout(() => {
          const add = document.querySelector("#add");
          add.onclick = () => {
            if (document.querySelector("[data-selected]"))
              localStorage.setItem("${storageKey}", JSON.stringify([{ id: "${productId}", variantId: "${variantId}", quantity: 1 }]));
          };
          add.dataset.baciPdpCartReady = "true";
        }, 200);
      </script>`,
    '/checkout': `<title>Checkout</title><input name="firstName"><script>
      const [line] = JSON.parse(localStorage.getItem('${storageKey}') ?? '[]');
      if (line) {
        const summary = document.createElement('div');
        summary.textContent = 'Synthetic device';
        summary.dataset.baciCheckoutProduct = line.id;
        summary.dataset.baciCheckoutVariant = line.variantId;
        summary.dataset.baciCheckoutQuantity = line.quantity;
        document.body.append(summary);
      }
      </script>`,
  };
  const asResource = (path: keyof typeof body) => ({
    url: `${origin}${path}`,
    mime: 'text/html',
    bytes: Buffer.from(body[path]).toString('base64'),
    headers: {},
  });
  const relay = vi.fn(async () => ({ status: 200, body: '{}' }));
  try {
    const observation = await observePublicBrowser(
      {
        ...payload,
        product: { ...payload.product, variantId },
        expected: {
          ...payload.expected,
          routes: [payload.expected.routes[0]],
          product: {
            ...product,
            native: true,
            variantId,
            nativeCheckout: { merchantSlug: 'synthetic', variantLabel: 'Blue' },
          },
        },
        resources: [
          ...payload.resources.filter(
            (item) =>
              item.url !== `${origin}${product.path}` &&
              !item.url.endsWith(encodeURIComponent(product.path))
          ),
          asResource(product.path),
          asResource('/checkout'),
        ],
      },
      browser,
      relay
    );
    expect(
      observation.journey.steps.map(({ action, path }) => [action, path])
    ).toEqual([
      ['navigate', '/'],
      ['product', product.path],
      ['cart-add', product.path],
      ['cart-read', '/checkout'],
      ['checkout-review', '/checkout'],
    ]);
    expect(observation.journey).toMatchObject({
      orderRequests: 0,
      paymentRequests: 0,
    });
    expect(relay).toHaveBeenCalledExactlyOnceWith({
      url: `${origin}/api/csrf`,
      method: 'GET',
    });
  } finally {
    await browser.close();
  }
}, 30000);

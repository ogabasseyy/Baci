import { cartItem, merchant } from './fixtures';
import { expect, test } from './network';
import { order, seedCheckout } from './setup';

// Shared-cart checkout submits the prepared binding: the order request
// carries shared_cart (session + generation + reviewed version) and each
// item carries its server line id. All cart/order endpoints are
// intercepted fixtures; the network guard aborts anything unexpected, so
// no live cart, order or provider endpoint is ever contacted.

const CART_ID = '22222222-2222-4222-8222-222222222222';
const LINE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const SESSION_ID = '55555555-5555-4555-8555-555555555555';

const snapshot = {
  cartId: CART_ID,
  merchantId: merchant.id,
  state: 'active',
  version: 3,
  lines: [
    {
      id: LINE_ID,
      item: { productId: cartItem.id },
      quantity: 1,
      unitPriceMinor: 10000000,
      lineTotalMinor: 10000000,
    },
  ],
  currency: 'NGN',
  subtotalMinor: 10000000,
  totalMinor: 10000000,
  estimatedTotals: false,
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

const prepareSnapshot = {
  cartId: CART_ID,
  cartVersion: 3,
  checkoutSessionId: SESSION_ID,
  estimates: {
    currency: 'NGN',
    lineCount: 1,
    subtotalMinor: 10000000,
    unavailableCount: 0,
  },
  generation: 1,
  lines: [
    {
      assuranceRate: null,
      available: true,
      condition: null,
      effectiveUnitPriceMinor: 10000000,
      hasAssurance: false,
      id: LINE_ID,
      lastUnitPriceMinor: 10000000,
      manageStock: false,
      negotiatedUnitPriceMinor: null,
      negotiationInvalidated: false,
      negotiationStatus: null,
      options: {},
      priceChanged: false,
      productId: cartItem.id,
      quantity: 1,
      stockQty: 10,
      unavailableReason: null,
      validatedUnitPriceMinor: 10000000,
      variantId: null,
      voucherAwardId: null,
      voucherToken: null,
    },
  ],
  merchantId: merchant.id,
};

const productRow = {
  id: cartItem.id,
  name: cartItem.name,
  description: cartItem.description,
  status: 'active',
  price: cartItem.price,
  manage_stock: false,
  stock: 10,
  stock_quantity: 10,
  has_variants: false,
  has_condition_offers: false,
  brand: 'Fixture',
  gtin: '',
  mpn: '',
  merchant_id: merchant.id,
  images: ['/phone.svg'],
  imageHint: 'Phone',
};

async function mockSharedSession(page: Parameters<typeof seedCheckout>[0]) {
  await page.route('**/api/storefront/cart', (route) => {
    if (route.request().method() !== 'GET')
      return route.abort('blockedbyclient');
    return route.fulfill({ json: { cart: snapshot, warnings: [] } });
  });
  await page.route('http://127.0.0.1:54329/rest/v1/products*', (route) =>
    route.fulfill({ json: [productRow] })
  );
  // The seeded legacy cache doubles as the display shell source, and the
  // import receipt tells the hook this cart was already imported: no
  // fallback render, no import traffic, deterministic adoption.
  await page.addInitScript((cartId: string) => {
    window.localStorage.setItem(
      'baci-cart-ogabassey-shared-import',
      JSON.stringify({
        cartId,
        importedAt: new Date().toISOString(),
        lineCount: 1,
      })
    );
  }, CART_ID);
}

test('shared cart checkout submits the prepared binding', async ({ page }) => {
  await seedCheckout(page, {});
  await mockSharedSession(page);
  const prepares: unknown[] = [];
  const submissions: unknown[] = [];

  await page.route('**/api/storefront/cart/checkout', (route) => {
    prepares.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        replayed: false,
        sessionReused: false,
        snapshot: prepareSnapshot,
      },
    });
  });
  await page.route('**/api/orders', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { order, amountDueToGateway: order.total } });
  });
  await page.route('**/api/payments/initialize', (route) =>
    route.fulfill({
      json: {
        success: true,
        reference: 'fixture-payment-reference',
        authorization_url: '/payment-handoff',
      },
    })
  );

  await page.goto('/checkout-shared');
  // The adopted server line renders (inside the collapsed summary).
  await expect(page.getByText(cartItem.name).first()).toBeAttached();
  await page.getByRole('radio', { name: /paystack/i }).press('Space');
  await page.getByRole('button', { name: 'Place Order', exact: true }).click();
  await expect(page).toHaveURL(/\/payment-handoff$/);

  expect(prepares).toHaveLength(1);
  expect(prepares[0]).toMatchObject({
    cartId: CART_ID,
    expectedVersion: 3,
    operationId: expect.any(String),
  });
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    items: [expect.objectContaining({ cart_line_id: LINE_ID })],
    shared_cart: {
      cart_id: CART_ID,
      cart_version: 3,
      checkout_generation: 1,
      checkout_session_id: SESSION_ID,
    },
  });
});

// The stale flow deliberately injects a 409 prepare response; allow its
// single resource-load console error.
test.describe('stale shared review', () => {
  test.use({
    allowedConsoleErrors: [
      'Failed to load resource: the server responded with a status of 409 (Conflict)',
    ],
  });

  test('a stale shared review refreshes the cart and never submits', async ({
    page,
  }) => {
    await seedCheckout(page, {});
    await mockSharedSession(page);
    let prepares = 0;
    let submissions = 0;

    await page.route('**/api/storefront/cart/checkout', (route) => {
      prepares++;
      return route.fulfill({
        json: {
          code: 'refresh_required',
          currentVersion: 4,
          error: 'Cart changed.',
        },
        status: 409,
      });
    });
    await page.route('**/api/orders', (route) => {
      submissions++;
      return route.fulfill({
        json: { order, amountDueToGateway: order.total },
      });
    });

    await page.goto('/checkout-shared');
    await expect(page.getByText(cartItem.name).first()).toBeAttached();
    await page.getByRole('radio', { name: /paystack/i }).press('Space');
    await page
      .getByRole('button', { name: 'Place Order', exact: true })
      .click();

    // The submit stops at review: no order request, checkout stays put.
    await expect.poll(() => prepares, { timeout: 10000 }).toBe(1);
    await page.waitForTimeout(500);
    expect(submissions).toBe(0);
    await expect(page).toHaveURL(/\/checkout-shared$/);
    await expect(
      page.getByRole('button', { name: 'Place Order', exact: true })
    ).toBeEnabled();
  });
});

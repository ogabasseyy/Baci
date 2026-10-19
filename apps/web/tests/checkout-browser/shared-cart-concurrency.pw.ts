import { cartItem, merchant } from './fixtures';
import { expect, test } from './network';
import { order, seedCheckout } from './setup';

// Two linked surfaces share one canonical cart. When the second surface
// removes the line, the first surface's checkout review goes stale: it
// must refresh and must never submit an order for the removed line.
// Every cart/order endpoint is an intercepted fixture; the network guard
// aborts anything unexpected, so no live cart or order is ever touched.

const CART_ID = '22222222-2222-4222-8222-222222222222';
const LINE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

function snapshot(version: number, lines: unknown[]) {
  return {
    cartId: CART_ID,
    merchantId: merchant.id,
    state: 'active',
    version,
    lines,
    currency: 'NGN',
    subtotalMinor: lines.length ? 10000000 : 0,
    totalMinor: lines.length ? 10000000 : 0,
    estimatedTotals: false,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

const line = {
  id: LINE_ID,
  item: { productId: cartItem.id },
  quantity: 1,
  unitPriceMinor: 10000000,
  lineTotalMinor: 10000000,
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

test.describe('shared cart concurrency', () => {
  test.use({
    allowedConsoleErrors: [
      'Failed to load resource: the server responded with a status of 409 (Conflict)',
    ],
  });
  test('a removal on another surface blocks a stale checkout submission', async ({
    page: pageA,
    browser,
  }) => {
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    let version = 3;
    let lines: unknown[] = [line];
    let refreshAllowed = false;
    const submissions: unknown[] = [];
    const prepares: unknown[] = [];
    const unexpectedB: string[] = [];
    const errorsB: string[] = [];
    pageB.on('pageerror', (error) => errorsB.push(error.message));
    await seedCheckout(pageA, {});
    await pageA.route(/\/api\/storefront\/cart(?:\?.*)?$/, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            json: {
              cart: snapshot(
                refreshAllowed ? version : 3,
                refreshAllowed ? lines : [line]
              ),
              warnings: [],
            },
          })
        : route.abort('blockedbyclient')
    );
    await pageA.route('http://127.0.0.1:54329/rest/v1/products*', (route) =>
      route.fulfill({ json: [productRow] })
    );
    await pageA.addInitScript(
      (cartId) =>
        localStorage.setItem(
          'baci-cart-ogabassey-shared-import',
          JSON.stringify({
            cartId,
            importedAt: new Date().toISOString(),
            lineCount: 1,
          })
        ),
      CART_ID
    );
    await pageA.route(
      /\/api\/storefront\/cart\/checkout(?:\?.*)?$/,
      (route) => {
        const body = route.request().postDataJSON() as {
          expectedVersion: number;
        };
        prepares.push(body);
        refreshAllowed = true;
        return route.fulfill({
          status: 409,
          json: {
            code: 'refresh_required',
            currentVersion: version,
            error: 'Cart changed.',
          },
        });
      }
    );
    await pageA.route(/\/api\/orders(?:\?.*)?$/, (route) => {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({
        json: { order, amountDueToGateway: order.total },
      });
    });
    try {
      // Surface A first adopts revision 3; the other surface edits afterward.
      await pageA.goto('/checkout-shared');
      await expect(pageA.getByText(cartItem.name).first()).toBeAttached();
      const origin = new URL(pageA.url()).origin;
      // The normal network fixture guards A. B is a separate context and must
      // have its own deny-by-default guard before any navigation or fetch.
      await contextB.route('**/*', (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (
          url.origin === origin &&
          url.pathname === '/cart-peer' &&
          request.method() === 'GET'
        )
          return route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><link rel="icon" href="data:,">Cart peer',
          });
        if (
          url.origin === origin &&
          url.pathname === '/api/storefront/cart/commands' &&
          request.method() === 'POST'
        ) {
          expect(request.postDataJSON()).toMatchObject({
            expectedVersion: 3,
            command: { type: 'remove', lineId: LINE_ID },
          });
          version = 4;
          lines = [];
          return route.fulfill({
            json: {
              cart: snapshot(version, lines),
              replayed: false,
              warnings: [],
            },
          });
        }
        unexpectedB.push(`${request.method()} ${url.pathname}`);
        return route.abort('blockedbyclient');
      });
      await pageB.goto(`${origin}/cart-peer`);
      await pageB.evaluate(
        async ({ cartId, lineId }) => {
          const response = await fetch('/api/storefront/cart/commands', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operationId: 'remove-from-b',
              expectedVersion: 3,
              command: { type: 'remove', lineId },
              cartId,
            }),
          });
          if (!response.ok) throw new Error('Fixture removal failed');
        },
        { cartId: CART_ID, lineId: LINE_ID }
      );
      expect(version).toBe(4);
      await pageA.getByRole('radio', { name: /paystack/i }).press('Space');
      await pageA
        .getByRole('button', { name: 'Place Order', exact: true })
        .click();
      // Wait for the real stale-review recovery, not an arbitrary timer.
      await expect(pageA.getByText(cartItem.name).first()).not.toBeAttached();
      expect(prepares).toHaveLength(1);
      expect(prepares[0]).toMatchObject({ expectedVersion: 3 });
      expect(submissions).toHaveLength(0);
      expect(unexpectedB).toEqual([]);
      expect(errorsB).toEqual([]);
    } finally {
      await contextB.close();
    }
  });
});

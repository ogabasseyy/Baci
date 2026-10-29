import type { Page } from '@playwright/test';

/** Isolated shared-cart fixture; all order and payment responses are synthetic. */
export async function seedRedvaultSharedPickup(
  page: Page,
  baseURL: string,
  options: { lostOrderResponses?: number } = {}
) {
  const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  const cartId = '22222222-2222-4222-8222-222222222222';
  const lineId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
  const sessionId = '55555555-5555-4555-8555-555555555555';
  const productId = '33333333-3333-4333-8333-333333333333';
  const item = {
    id: productId,
    cartItemId: productId,
    name: 'Checkout test phone',
    description: 'Synthetic fixture',
    price: 100,
    quantity: 1,
    status: 'active',
    manage_stock: false,
    stock: 10,
    image: '/phone.svg',
    imageLarge: '/phone.svg',
    imageHint: 'Phone',
    brand: 'Fixture',
    gtin: '',
    mpn: '',
  };
  await page.addInitScript(
    ({ seededItem, seededCartId }) => {
      if (sessionStorage.getItem('checkout-browser-fixture-seeded')) return;
      sessionStorage.setItem('checkout-browser-fixture-seeded', '1');
      localStorage.setItem(
        'baci-cart-ogabassey-guest',
        JSON.stringify([seededItem])
      );
      localStorage.setItem(
        'baci-cart-ogabassey-shared-import',
        JSON.stringify({
          cartId: seededCartId,
          importedAt: new Date().toISOString(),
          lineCount: 1,
        })
      );
      sessionStorage.setItem(
        'checkout-form',
        JSON.stringify({
          firstName: 'Ada',
          lastName: 'Okon',
          customerEmail: 'ada@example.test',
          customerPhone: '+2348031234567',
          currentStep: 'payment',
          completedSteps: { contact: true, delivery: true },
          newAddressState: 'Lagos',
          newAddressCity: 'Ikeja',
          deliveryMethod: 'pickup',
        })
      );
    },
    { seededItem: item, seededCartId: cartId }
  );

  const calls = {
    orders: 0,
    createdOrders: 0,
    orderRequests: [] as Array<{
      body: string | null;
      key: string | undefined;
    }>,
    recoveryHeaders: [] as Array<string | undefined>,
    prepareBodies: [] as Record<string, unknown>[],
    cancellations: 0,
    initializations: 0,
    emptyQuotes: 0,
  };
  let submitted = false;
  const cart = {
    cartId,
    merchantId,
    state: 'active',
    version: 3,
    lines: [
      {
        id: lineId,
        item: { productId },
        quantity: 1,
        unitPriceMinor: 10_000,
        lineTotalMinor: 10_000,
      },
    ],
    currency: 'NGN',
    subtotalMinor: 10_000,
    totalMinor: 10_000,
    estimatedTotals: false,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const review = {
    cartId,
    cartVersion: 3,
    checkoutSessionId: sessionId,
    estimates: {
      currency: 'NGN',
      lineCount: 1,
      subtotalMinor: 10_000,
      unavailableCount: 0,
    },
    generation: 1,
    merchantId,
    lines: [
      {
        assuranceRate: null,
        available: true,
        condition: null,
        effectiveUnitPriceMinor: 10_000,
        hasAssurance: false,
        id: lineId,
        lastUnitPriceMinor: 10_000,
        manageStock: false,
        negotiatedUnitPriceMinor: null,
        negotiationInvalidated: false,
        negotiationStatus: null,
        options: {},
        priceChanged: false,
        productId,
        quantity: 1,
        stockQty: 10,
        unavailableReason: null,
        validatedUnitPriceMinor: 10_000,
        variantId: null,
        voucherAwardId: null,
        voucherToken: null,
      },
    ],
  };
  const summary = {
    product_subtotal_kobo: 10_000,
    eligible_subtotal_kobo: 10_000,
    ineligible_subtotal_kobo: 0,
    discount_kobo: 500,
    assurance_fee_kobo: 0,
    tax_kobo: 750,
    shipping_kobo: 0,
    gift_wrapping_kobo: 0,
    payable_kobo: 10_250,
    mixed_basket: false,
  };

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.hostname === '127.0.0.1' &&
      url.port === '54329' &&
      url.pathname === '/rest/v1/products'
    )
      return route.fulfill({
        json: [
          {
            ...item,
            stock_quantity: 10,
            has_variants: false,
            has_condition_offers: false,
            merchant_id: merchantId,
            images: ['/phone.svg'],
          },
        ],
      });
    if (url.origin !== baseURL) return route.fallback();
    if (url.pathname === '/api/storefront/cart/checkout') {
      calls.prepareBodies.push(request.postDataJSON());
      return route.fulfill({
        json: { replayed: false, sessionReused: false, snapshot: review },
      });
    }
    if (url.pathname === '/api/storefront/cart')
      return route.fulfill({
        json: {
          cart: submitted ? { ...cart, state: 'completed', version: 4 } : cart,
          warnings: [],
        },
      });
    if (url.pathname === '/api/storefront/cart/bootstrap')
      return route.fulfill({ status: 201, json: { expiresAt: 'fixture' } });
    if (url.pathname === '/api/payments/redvault/availability')
      return route.fulfill({
        json: { available: true, reason: 'public_product_test' },
      });
    if (url.pathname === '/api/shipping/quotes') {
      const body: { items?: unknown[] } = request.postDataJSON();
      if (!body.items?.length) {
        calls.emptyQuotes += 1;
        return route.fulfill({
          status: 400,
          json: { error: 'At least one item is required' },
        });
      }
      return route.fulfill({ json: { quotes: [] } });
    }
    if (url.pathname === '/api/orders' && request.method() === 'POST') {
      calls.orders += 1;
      const submittedRequest = {
        body: request.postData(),
        key: request.headers()['idempotency-key'],
      };
      calls.orderRequests.push(submittedRequest);
      calls.recoveryHeaders.push(request.headers()['x-checkout-recovery']);
      if (!submitted) calls.createdOrders += 1;
      else if (
        JSON.stringify(submittedRequest) !==
        JSON.stringify(calls.orderRequests[0])
      ) {
        return route.fulfill({
          status: 409,
          json: { error: 'Different checkout attempt' },
        });
      }
      submitted = true;
      if (calls.orders <= (options.lostOrderResponses ?? 0))
        return route.abort('failed');
      return route.fulfill({
        status: calls.orders === 1 ? 201 : 200,
        json: {
          order: {
            id: '44444444-4444-4444-8444-444444444444',
            order_number: 'TEST-1001',
            total: 102.5,
            currency: 'NGN',
            payment_status: 'unpaid',
            payment_method: 'uba_redvault',
            tracking_token: 'fixture-tracking-token',
          },
          redvault: { status: 'pending', quote: summary },
        },
      });
    }
    if (
      url.pathname.startsWith('/api/storefront/orders/') &&
      url.pathname.endsWith('/cancel')
    ) {
      calls.cancellations += 1;
      return route.fulfill({ json: { success: true, cancelled: true } });
    }
    if (url.pathname === '/api/payments/initialize') {
      calls.initializations += 1;
      return route.fulfill({
        json: {
          success: true,
          reference: 'fixture-redvault-ref',
          authorization_url: `${baseURL}/payment-handoff`,
        },
      });
    }
    if (
      request.resourceType() === 'document' ||
      request.resourceType() === 'script'
    ) {
      const response = await route.fetch();
      const body = (await response.text()).replaceAll(
        '11111111-1111-4111-8111-111111111111',
        merchantId
      );
      return route.fulfill({ response, body });
    }
    return route.fallback();
  });
  return calls;
}

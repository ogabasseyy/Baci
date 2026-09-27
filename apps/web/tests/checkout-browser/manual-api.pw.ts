import { expect, test } from './network';
import { order, seedCheckout } from './setup';

test('manual mode serves deterministic quote, order-reuse, storefront-read, and provider-error fixtures', async ({
  page,
}) => {
  await seedCheckout(page);
  const cartValidation = page.waitForResponse('**/api/cart/validate');
  await page.goto('/checkout?qa=manual-api-integration');
  await (await cartValidation).finished();
  await page.context().addCookies([
    {
      name: 'checkout-qa-scenario',
      value: 'provider-error',
      url: page.url(),
    },
  ]);

  const results = await page.evaluate(
    async ({ orderId, trackingToken }) => {
      const csrfToken = document.cookie.match(
        /(?:^|;\s*)(?:__Host-)?csrf-token=([^;]+)/
      )?.[1];
      const csrfHeaders = {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken ?? '',
      };
      const missingCsrfResponse = await fetch('/api/cart/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartItems: [] }),
      });
      const mismatchedCsrfResponse = await fetch('/api/cart/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': 'not-the-fixture-cookie-token',
        },
        body: JSON.stringify({ cartItems: [] }),
      });
      const invalidCartResponse = await fetch('/api/cart/validate', {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({ cartItems: 'not-an-array' }),
      });
      const invalidQuoteResponse = await fetch('/api/shipping/quotes', {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({ deliveryPreference: 'door' }),
      });
      const invalidCreateResponse = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          ...csrfHeaders,
          'Idempotency-Key': 'manual-qa-invalid-order-key',
        },
        body: JSON.stringify({}),
      });
      const missingOrderCsrfResponse = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const quoteResponse = await fetch('/api/shipping/quotes', {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          deliveryPreference: 'door',
          receiver: {
            name: 'Ada Okon',
            email: 'ada@example.test',
            phone: '+2348031234567',
            address: '12 Broad Street',
            city: 'Lagos Island',
            state: 'Lagos',
            country: 'Nigeria',
            countryCode: 'NG',
          },
          items: [
            {
              name: 'Checkout test phone',
              quantity: 1,
              weight: 1,
              value: 100000,
            },
          ],
        }),
      });
      const createResponse = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          ...csrfHeaders,
          'Idempotency-Key': 'manual-qa-fixture-order-key',
        },
        body: JSON.stringify({
          merchant_id: '11111111-1111-4111-8111-111111111111',
          customer_email: 'ada@example.test',
          customer_name: 'Ada Okon',
          customer_phone: '+2348031234567',
          items: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              name: 'Checkout test phone',
              quantity: 1,
              price: 100000,
            },
          ],
          subtotal: 100000,
          tax_amount: 7500,
          payment_method: 'card',
          delivery_method: 'pickup',
          shipping_address: {
            address: 'Store Pickup',
            city: 'Ikeja',
            state: 'Lagos',
          },
        }),
      });
      const storefrontOrderResponse = await fetch(
        `/api/storefront/orders/${orderId}?tracking_token=${trackingToken}&merchant_slug=ogabassey`
      );
      const invalidStorefrontOrderResponse = await fetch(
        `/api/storefront/orders/${orderId}?tracking_token=wrong&merchant_slug=ogabassey`
      );
      const reuseResponse = await fetch('/api/orders/reuse', {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          order_id: orderId,
          tracking_token: trackingToken,
          merchant_id: '11111111-1111-4111-8111-111111111111',
          customer_email: 'ada@example.test',
          payment_method: 'card',
        }),
      });
      const invalidReuseResponse = await fetch('/api/orders/reuse', {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({ order_id: orderId }),
      });
      const missingReuseCsrfResponse = await fetch('/api/orders/reuse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId }),
      });
      const paymentRequest = {
        merchant_id: '11111111-1111-4111-8111-111111111111',
        order_id: orderId,
        customer_email: 'ada@example.test',
        customer_name: 'Ada Okon',
        customer_phone: '+2348031234567',
        gateway: 'korapay',
        billing_address: {
          line1: '1 Main Street',
          city: 'Ikeja',
          country: 'NG',
        },
      };
      const invalidPaymentResponse = await fetch('/api/payments/initialize', {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({ gateway: 'korapay' }),
      });
      const missingPaymentCsrfResponse = await fetch(
        '/api/payments/initialize',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(paymentRequest),
        }
      );
      const paymentResponse = await fetch('/api/payments/initialize', {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify(paymentRequest),
      });
      // biome-ignore lint/suspicious/noDocumentCookie: browser fixture switches its local payment scenario in-page
      document.cookie = 'checkout-qa-scenario=success; Path=/; SameSite=Lax';
      const successfulPaymentResponse = await fetch(
        '/api/payments/initialize',
        {
          method: 'POST',
          headers: csrfHeaders,
          body: JSON.stringify(paymentRequest),
        }
      );

      return {
        quote: await quoteResponse.json(),
        createdOrder: await createResponse.json(),
        storefrontOrder: await storefrontOrderResponse.json(),
        invalidStorefrontOrderStatus: invalidStorefrontOrderResponse.status,
        reusedOrder: await reuseResponse.json(),
        invalidReuseStatus: invalidReuseResponse.status,
        paymentError: await paymentResponse.json(),
        paymentStatus: paymentResponse.status,
        successfulPayment: await successfulPaymentResponse.json(),
        successfulPaymentStatus: successfulPaymentResponse.status,
        invalidCreateStatus: invalidCreateResponse.status,
        missingCsrfStatus: missingCsrfResponse.status,
        mismatchedCsrfStatus: mismatchedCsrfResponse.status,
        missingOrderCsrfStatus: missingOrderCsrfResponse.status,
        missingReuseCsrfStatus: missingReuseCsrfResponse.status,
        missingPaymentCsrfStatus: missingPaymentCsrfResponse.status,
        invalidCartStatus: invalidCartResponse.status,
        invalidQuoteStatus: invalidQuoteResponse.status,
        invalidPaymentStatus: invalidPaymentResponse.status,
        csrfCookie: document.cookie.includes('csrf-token=fixture-csrf-token'),
      };
    },
    { orderId: order.id, trackingToken: order.tracking_token }
  );

  expect(results.quote.quotes).toMatchObject({
    featured: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        provider: 'GIGL',
        serviceTier: 'Standard',
        estimatedDays: 1,
        price: 0,
        isStationPickup: false,
      },
    ],
    all: [{ id: '55555555-5555-4555-8555-555555555555' }],
  });
  expect(results.createdOrder).toMatchObject({
    amountDueToGateway: 107500,
    order: { id: order.id, shipping_fee: 0, total: 107500 },
  });
  expect(results.storefrontOrder).toMatchObject({ id: order.id });
  expect(results.invalidStorefrontOrderStatus).toBe(404);
  expect(results.reusedOrder).toMatchObject({ order: { id: order.id } });
  expect(results.invalidReuseStatus).toBe(400);
  expect(results.paymentStatus).toBe(503);
  expect(results.missingCsrfStatus).toBe(403);
  expect(results.mismatchedCsrfStatus).toBe(403);
  expect(results.missingOrderCsrfStatus).toBe(403);
  expect(results.missingReuseCsrfStatus).toBe(403);
  expect(results.missingPaymentCsrfStatus).toBe(403);
  expect(results.invalidCartStatus).toBe(400);
  expect(results.invalidQuoteStatus).toBe(400);
  expect(results.invalidPaymentStatus).toBe(400);
  expect(results.successfulPaymentStatus).toBe(200);
  expect(results.successfulPayment).toMatchObject({
    success: true,
    authorization_url: '/payment-handoff',
  });
  expect(results.invalidCreateStatus).toBe(400);
  expect(results.csrfCookie).toBe(true);
  expect(results.paymentError).toEqual({
    error: 'Fixture provider error. No payment was sent.',
  });
});

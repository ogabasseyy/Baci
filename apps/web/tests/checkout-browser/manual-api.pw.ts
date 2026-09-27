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

  const results = await page.evaluate(async (orderId) => {
    const quoteResponse = await fetch('/api/shipping/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryPreference: 'door' }),
    });
    const createResponse = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'manual-qa-fixture-order-key',
      },
      body: JSON.stringify({}),
    });
    const storefrontOrderResponse = await fetch(
      `/api/storefront/orders/${orderId}`
    );
    const reuseResponse = await fetch('/api/orders/reuse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    });
    const paymentResponse = await fetch('/api/payments/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateway: 'korapay' }),
    });

    return {
      quote: await quoteResponse.json(),
      createdOrder: await createResponse.json(),
      storefrontOrder: await storefrontOrderResponse.json(),
      reusedOrder: await reuseResponse.json(),
      paymentError: await paymentResponse.json(),
      paymentStatus: paymentResponse.status,
    };
  }, order.id);

  expect(results.quote.quotes).toMatchObject([
    { id: 'fixture-door', price: 0, isStationPickup: false },
  ]);
  expect(results.createdOrder).toMatchObject({
    amountDueToGateway: 107500,
    order: { id: order.id, shipping_fee: 0, total: 107500 },
  });
  expect(results.storefrontOrder).toMatchObject({ id: order.id });
  expect(results.reusedOrder).toMatchObject({ order: { id: order.id } });
  expect(results.paymentStatus).toBe(503);
  expect(results.paymentError).toEqual({
    error: 'Fixture provider error. No payment was sent.',
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));

vi.mock('@/hooks/cart/shared-cart-checkout-client', async (importActual) => ({
  ...(await importActual<
    typeof import('@/hooks/cart/shared-cart-checkout-client')
  >()),
  prepareSharedCartCheckout: mocks.prepare,
}));

import {
  handleChatwootCheckoutPlace,
  resetChatwootCheckoutOrderMemory,
} from './chatwoot-checkout-place-action';
import {
  checkoutPlaceRequest,
  happyHandlers,
  lastResult,
  merchantQuote,
  paths,
  placeInput,
  preparedCheckout,
  quotes,
  stubCheckoutFetch,
} from './chatwoot-checkout-test-fixtures';

beforeEach(() => {
  resetChatwootCheckoutOrderMemory();
  mocks.prepare.mockReset();
  mocks.prepare.mockResolvedValue(preparedCheckout());
});
afterEach(() => vi.unstubAllGlobals());

describe('handleChatwootCheckoutPlace delivery, order and payment failures', () => {
  it('delivery_unavailable when no merchant rate matches the displayed option', async () => {
    const { calls } = stubCheckoutFetch({
      ...happyHandlers(),
      '/api/shipping/quotes': () =>
        quotes(merchantQuote({ displayName: 'Other delivery' })),
    });
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'delivery_unavailable' });
    expect(paths(calls)).toEqual(['/api/shipping/quotes']);
  });

  it('delivery_unavailable when the price or pickup flag differs', async () => {
    stubCheckoutFetch({
      ...happyHandlers(),
      '/api/shipping/quotes': () => quotes(merchantQuote({ price: 3000 })),
    });
    const repriced = placeInput();
    await handleChatwootCheckoutPlace(repriced);
    expect(lastResult(repriced)).toMatchObject({
      code: 'delivery_unavailable',
    });

    const pickupAsked = placeInput({
      request: {
        ...checkoutPlaceRequest,
        delivery: { ...checkoutPlaceRequest.delivery, pickup: true },
      },
    });
    stubCheckoutFetch(happyHandlers());
    await handleChatwootCheckoutPlace(pickupAsked);
    expect(lastResult(pickupAsked)).toMatchObject({
      code: 'delivery_unavailable',
    });
  });

  it('delivery_unavailable when two merchant rates match the option (ambiguous)', async () => {
    const { calls } = stubCheckoutFetch({
      ...happyHandlers(),
      '/api/shipping/quotes': () =>
        quotes(merchantQuote(), merchantQuote({ id: 'mrate_rate-2' })),
    });
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'delivery_unavailable' });
    expect(paths(calls)).not.toContain('/api/orders');
  });

  it('delivery_unavailable when the matching quote is not a merchant rate', async () => {
    stubCheckoutFetch({
      ...happyHandlers(),
      '/api/shipping/quotes': () =>
        quotes(merchantQuote({ provider: 'GIGL', id: 'quote-uuid' })),
    });
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'delivery_unavailable' });
  });

  it('delivery_unavailable when the quote service fails', async () => {
    stubCheckoutFetch({
      ...happyHandlers(),
      '/api/shipping/quotes': () => ({
        status: 503,
        body: { error: 'down' },
      }),
    });
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'delivery_unavailable' });
  });

  it('order_failed without leaking the server error text', async () => {
    stubCheckoutFetch({
      ...happyHandlers(),
      '/api/orders': () => ({
        status: 400,
        body: { error: 'Failed to create order', details: 'secret-detail' },
      }),
    });
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toEqual({
      requestId: 'place-request-1',
      status: 'failed',
      code: 'order_failed',
    });
    expect(
      JSON.stringify(vi.mocked(input.postResult).mock.calls)
    ).not.toContain('secret-detail');
  });

  it('maps a rejected shipping rate to delivery_unavailable and an idempotency conflict to cart_changed', async () => {
    stubCheckoutFetch({
      ...happyHandlers(),
      '/api/orders': () => ({
        status: 400,
        body: { code: 'SHIPPING_RATE_INVALID' },
      }),
    });
    const rejected = placeInput();
    await handleChatwootCheckoutPlace(rejected);
    expect(lastResult(rejected)).toMatchObject({
      code: 'delivery_unavailable',
    });

    stubCheckoutFetch({
      ...happyHandlers(),
      '/api/orders': () => ({
        status: 409,
        body: { code: 'CHECKOUT_IDEMPOTENCY_CONFLICT' },
      }),
    });
    const conflict = placeInput();
    await handleChatwootCheckoutPlace(conflict);
    expect(lastResult(conflict)).toMatchObject({ code: 'cart_changed' });
  });

  it('order_failed when the order request itself cannot be sent', async () => {
    stubCheckoutFetch({
      ...happyHandlers(),
      '/api/orders': () => {
        throw new Error('network down');
      },
    });
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'order_failed' });
  });

  it('payment_unavailable with the order number when bank transfer cannot start', async () => {
    stubCheckoutFetch({
      ...happyHandlers(),
      '/api/payments/initialize': () => ({
        status: 500,
        body: { error: 'Paystack said: secret provider text' },
      }),
    });
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toEqual({
      requestId: 'place-request-1',
      status: 'failed',
      code: 'payment_unavailable',
      orderNumber: 'ORD-1001',
    });
    expect(
      JSON.stringify(vi.mocked(input.postResult).mock.calls)
    ).not.toContain('secret provider text');
  });

  it('payment_unavailable when the gateway returns incomplete bank details', async () => {
    stubCheckoutFetch({
      ...happyHandlers(),
      '/api/payments/initialize': () => ({
        body: {
          success: true,
          reference: 'ref-123',
          dva: {
            bank_name: 'Wema Bank',
            account_number: '',
            account_name: 'X',
          },
        },
      }),
    });
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({
      code: 'payment_unavailable',
      orderNumber: 'ORD-1001',
    });
  });
});

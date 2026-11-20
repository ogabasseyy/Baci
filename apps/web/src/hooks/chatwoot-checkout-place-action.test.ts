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
  CHECKOUT_CART_ID,
  CHECKOUT_CART_VERSION,
  checkoutPlaceRequest,
  dvaReady,
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

describe('handleChatwootCheckoutPlace', () => {
  it('places the order with the store checkout contract and returns bank details', async () => {
    const { calls } = stubCheckoutFetch(happyHandlers());
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(paths(calls)).toEqual([
      '/api/shipping/quotes',
      '/api/orders',
      '/api/payments/initialize',
    ]);
    const quoteBody = JSON.parse(String(calls[0]?.init.body));
    expect(quoteBody).toMatchObject({
      merchantId: 'merchant-1',
      merchant_rates_only: true,
      supports_merchant_rates: true,
      receiver: { state: 'Lagos', countryCode: 'NG', city: 'Lekki' },
    });
    expect(mocks.prepare).toHaveBeenCalledWith(
      {
        cartId: CHECKOUT_CART_ID,
        expectedVersion: CHECKOUT_CART_VERSION,
        operationId: expect.stringMatching(/^cw-op-[0-9a-f]{64}$/),
      },
      'store'
    );

    const orderCall = calls[1];
    const headers = orderCall?.init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(/^cw-chk-[0-9a-f]{64}$/);
    expect(JSON.parse(String(orderCall?.init.body))).toMatchObject({
      merchant_id: 'merchant-1',
      customer_email: 'ada@example.com',
      customer_name: 'Ada Obi',
      customer_phone: '+2348012345678',
      payment_method: 'bank_transfer',
      payment_status: 'unpaid',
      delivery_method: 'door',
      shipping_rate_id: 'rate-1',
      selected_quote_id: null,
      shipping_provider: null,
      shipping_fee: 2500,
      subtotal: 2000,
      tax_amount: 150,
      expected_total: 4650,
      use_wallet_credit: false,
      wallet_amount: 0,
      gift_wrapping_fee: 0,
      shipping_address: {
        address: '12 Admiralty Way',
        city: 'Lekki',
        state: 'Lagos',
        countryCode: 'NG',
      },
      shared_cart: {
        cart_id: 'cart-1',
        checkout_session_id: 'session-1',
        checkout_generation: 3,
        cart_version: 8,
      },
    });
    expect(JSON.parse(String(calls[2]?.init.body))).toMatchObject({
      gateway: 'paystack',
      payment_type: 'dva',
      order_id: 'order-uuid',
      merchant_id: 'merchant-1',
      customer_email: 'ada@example.com',
      currency: 'NGN',
      tracking_token: 'track-1',
    });
    expect(input.postResult).toHaveBeenCalledTimes(1);
    expect(lastResult(input)).toEqual({
      requestId: 'place-request-1',
      status: 'payment_ready',
      orderNumber: 'ORD-1001',
      amountMajor: 4650,
      currency: 'NGN',
      bank: {
        bankName: 'Wema Bank',
        accountNumber: '0123456789',
        accountName: 'Store / Ada Obi',
      },
      reference: 'ref-123',
    });
  });

  it('charges no VAT for an unregistered merchant', async () => {
    const { calls } = stubCheckoutFetch(happyHandlers());

    await handleChatwootCheckoutPlace(
      placeInput({ getMerchant: () => ({ id: 'merchant-1', taxRate: 0 }) })
    );

    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({
      tax_amount: 0,
      expected_total: 4500,
    });
  });

  it('routes a pickup choice to the station-pickup delivery method', async () => {
    const { calls } = stubCheckoutFetch({
      ...happyHandlers(),
      '/api/shipping/quotes': () =>
        quotes(
          merchantQuote(),
          merchantQuote({
            id: 'mrate_pickup-1',
            displayName: 'Ikeja pickup',
            price: 0,
            isStationPickup: true,
            stationName: 'Ikeja Shop',
            stationAddress: '1 Allen Avenue',
          })
        ),
    });
    const input = placeInput({
      request: {
        ...checkoutPlaceRequest,
        delivery: { displayName: 'Ikeja pickup', priceMajor: 0, pickup: true },
      },
    });

    await handleChatwootCheckoutPlace(input);

    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({
      delivery_method: 'pickup_station',
      shipping_rate_id: 'pickup-1',
      shipping_fee: 0,
      shipping_address: {
        address: 'Ikeja Shop, 1 Allen Avenue',
        state: 'Lagos',
      },
    });
    expect(lastResult(input)).toMatchObject({ status: 'payment_ready' });
  });

  it('does not post to a frame that is no longer current', async () => {
    stubCheckoutFetch(happyHandlers());
    const input = placeInput({ canPost: () => false });

    await handleChatwootCheckoutPlace(input);

    expect(input.postResult).not.toHaveBeenCalled();
  });

  describe('idempotent replay', () => {
    it('derives the same Idempotency-Key for the same request id and cart, after a reload', async () => {
      const keys: string[] = [];
      const { calls } = stubCheckoutFetch(happyHandlers());

      for (let attempt = 0; attempt < 2; attempt += 1) {
        resetChatwootCheckoutOrderMemory();
        await handleChatwootCheckoutPlace(placeInput());
      }
      for (const call of calls.filter(
        (entry) => entry.path === '/api/orders'
      )) {
        keys.push(
          (call.init.headers as Record<string, string>)['Idempotency-Key'] ?? ''
        );
      }

      expect(keys).toHaveLength(2);
      expect(keys[0]).toBe(keys[1]);
      const operationIds = mocks.prepare.mock.calls.map(
        ([input]) => (input as { operationId: string }).operationId
      );
      expect(operationIds[0]).toBe(operationIds[1]);
    });

    it('derives a different key for a different request id or cart', async () => {
      const { calls } = stubCheckoutFetch(happyHandlers());

      await handleChatwootCheckoutPlace(placeInput());
      await handleChatwootCheckoutPlace(
        placeInput({
          request: { ...checkoutPlaceRequest, requestId: 'place-request-2' },
        })
      );

      const keys = calls
        .filter((entry) => entry.path === '/api/orders')
        .map(
          (entry) =>
            (entry.init.headers as Record<string, string>)['Idempotency-Key']
        );
      expect(keys).toHaveLength(2);
      expect(keys[0]).not.toBe(keys[1]);
    });

    it('a repeat of the same request id creates no second order and only retries payment', async () => {
      let paymentAttempts = 0;
      const { calls } = stubCheckoutFetch({
        ...happyHandlers(),
        '/api/payments/initialize': () => {
          paymentAttempts += 1;
          return paymentAttempts === 1
            ? { status: 502, body: { error: 'gateway down' } }
            : dvaReady;
        },
      });
      const first = placeInput();
      const second = placeInput();

      await handleChatwootCheckoutPlace(first);
      await handleChatwootCheckoutPlace(second);

      expect(lastResult(first)).toMatchObject({
        code: 'payment_unavailable',
        orderNumber: 'ORD-1001',
      });
      expect(lastResult(second)).toMatchObject({
        status: 'payment_ready',
        orderNumber: 'ORD-1001',
      });
      expect(
        paths(calls).filter((path) => path === '/api/orders')
      ).toHaveLength(1);
      expect(
        paths(calls).filter((path) => path === '/api/payments/initialize')
      ).toHaveLength(2);
      expect(mocks.prepare).toHaveBeenCalledTimes(1);
    });

    it('a repeat after bank details were issued returns the same details without asking again', async () => {
      const { calls } = stubCheckoutFetch(happyHandlers());
      const first = placeInput();
      const second = placeInput();

      await handleChatwootCheckoutPlace(first);
      await handleChatwootCheckoutPlace(second);

      expect(lastResult(first)).toMatchObject({ status: 'payment_ready' });
      expect(lastResult(second)).toEqual(lastResult(first));
      expect(
        paths(calls).filter((path) => path === '/api/orders')
      ).toHaveLength(1);
      expect(
        paths(calls).filter((path) => path === '/api/payments/initialize')
      ).toHaveLength(1);
    });

    it('a repeat under a different merchant context is refused and starts no payment', async () => {
      const { calls } = stubCheckoutFetch({
        ...happyHandlers(),
        '/api/payments/initialize': () => ({ status: 502, body: {} }),
      });
      await handleChatwootCheckoutPlace(placeInput());
      const paymentCallsBefore = paths(calls).filter(
        (path) => path === '/api/payments/initialize'
      ).length;
      const replay = placeInput({
        getMerchant: () => ({ id: 'another-merchant', taxRate: 0 }),
      });

      await handleChatwootCheckoutPlace(replay);

      expect(lastResult(replay)).toEqual({
        requestId: checkoutPlaceRequest.requestId,
        status: 'failed',
        code: 'order_failed',
      });
      expect(
        paths(calls).filter((path) => path === '/api/payments/initialize')
      ).toHaveLength(paymentCallsBefore);
    });

    it('retries payment even after creating the order moved the cart version', async () => {
      let paymentAttempts = 0;
      const { calls } = stubCheckoutFetch({
        ...happyHandlers(),
        '/api/payments/initialize': () => {
          paymentAttempts += 1;
          return paymentAttempts === 1 ? { status: 502, body: {} } : dvaReady;
        },
      });
      await handleChatwootCheckoutPlace(placeInput());
      const retry = placeInput({
        snapshot: {
          cartVersion: 9,
          currency: 'NGN',
          estimatedTotals: false,
        },
        getCurrentCartRef: () => ({ cartId: CHECKOUT_CART_ID, version: 9 }),
      });

      await handleChatwootCheckoutPlace(retry);

      expect(lastResult(retry)).toMatchObject({ status: 'payment_ready' });
      expect(
        paths(calls).filter((path) => path === '/api/orders')
      ).toHaveLength(1);
    });
  });
});

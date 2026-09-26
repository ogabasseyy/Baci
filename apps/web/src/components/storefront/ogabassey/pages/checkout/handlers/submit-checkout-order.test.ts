import { describe, expect, it, vi } from 'vitest';
import { buildCheckoutOrderRequest } from '../build-checkout-order-request';
import { getCheckoutOrderErrorMessage } from '../checkout-order-error-message';
import { selectRejectedVoucherLines } from '../select-rejected-voucher-lines';
import {
  type CheckoutOrderErrorData,
  submitCheckoutOrder,
} from './submit-checkout-order';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function orderRequest() {
  return buildCheckoutOrderRequest({
    merchantId: 'merchant-1',
    items: [],
    paymentMethod: 'card',
    acceptsMarketing: false,
    customer: {
      name: 'Ada Customer',
      email: 'customer@example.com',
      phone: '08000000000',
    },
    money: {
      subtotal: 4200,
      shipping: 0,
      tax: 0,
      giftWrapping: 0,
      discountAmount: 0,
      useWalletCredit: false,
      walletAmount: 0,
    },
    delivery: {
      method: 'pickup',
      airportType: 'delivery',
      quoteMatchesMethod: false,
      selectedQuoteId: '',
      merchantRateId: null,
      provider: null,
      address: {
        address: 'Store',
        city: 'Lagos',
        state: 'Lagos',
        phone: '',
        countryCode: 'NG',
        country: 'Nigeria',
      },
    },
  });
}

describe('submitCheckoutOrder', () => {
  it('reuses a pending payable order without creating an idempotency key or a second order', async () => {
    const request = vi.fn<typeof fetch>();
    const getIdempotencyKey = vi.fn(async () => 'new-key');

    const result = await submitCheckoutOrder({
      resolvedPendingOrder: {
        reusableOrder: {
          order: { id: 'order-existing' },
          amountDueToGateway: 4200,
        },
        clearStoredOrder: false,
      },
      getIdempotencyKey,
      orderRequest: orderRequest(),
      paymentMethod: 'paystack',
      total: 4200,
      onVoucherRejected: vi.fn(),
      onPendingOrderInvalidated: vi.fn(async () => undefined),
      onShippingRateRejected: vi.fn(),
      getOrderErrorMessage: vi.fn(() => 'unreachable'),
      request,
    });

    expect(result).toEqual({
      order: { id: 'order-existing' },
      wallet: null,
      amountDueToGateway: 4200,
    });
    expect(getIdempotencyKey).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses to create through a paid or unknown REDVAULT fence', async () => {
    const request = vi.fn<typeof fetch>();
    for (const resolvedPendingOrder of [
      {
        reusableOrder: null,
        clearStoredOrder: true,
        paidOrder: { orderId: 'paid', customerEmail: 'customer@example.com' },
      },
      {
        reusableOrder: null,
        clearStoredOrder: false,
        redvaultUnresolved: true,
      },
    ]) {
      await expect(
        submitCheckoutOrder({
          resolvedPendingOrder,
          getIdempotencyKey: async () => 'new-key',
          orderRequest: orderRequest(),
          paymentMethod: 'paystack',
          total: 4200,
          onVoucherRejected: vi.fn(),
          onPendingOrderInvalidated: vi.fn(async () => undefined),
          onShippingRateRejected: vi.fn(),
          getOrderErrorMessage: () => 'unreachable',
          request,
        })
      ).rejects.toThrow(
        'Pending checkout order must be fenced before submission'
      );
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('invalidates a conflicting snapshot and forwards the rejection to voucher cleanup', async () => {
    const errorData = {
      code: 'CHECKOUT_IDEMPOTENCY_CONFLICT',
      error: 'Conflict',
    };
    const onVoucherRejected = vi.fn();
    const onPendingOrderInvalidated = vi.fn(async () => undefined);

    await expect(
      submitCheckoutOrder({
        resolvedPendingOrder: { reusableOrder: null, clearStoredOrder: false },
        getIdempotencyKey: async () => 'idempotency-key',
        orderRequest: orderRequest(),
        paymentMethod: 'paystack',
        total: 4200,
        onVoucherRejected,
        onPendingOrderInvalidated,
        onShippingRateRejected: vi.fn(),
        getOrderErrorMessage: () => 'Try again',
        request: vi.fn(async () =>
          response(errorData, 409)
        ) as unknown as typeof fetch,
      })
    ).rejects.toThrow('Try again');

    expect(onPendingOrderInvalidated).toHaveBeenCalledOnce();
    expect(onVoucherRejected).toHaveBeenCalledWith(errorData);
  });

  it('preserves pending keys when order creation has an interrupted network response', async () => {
    const onPendingOrderInvalidated = vi.fn(async () => undefined);
    await expect(
      submitCheckoutOrder({
        resolvedPendingOrder: { reusableOrder: null, clearStoredOrder: false },
        getIdempotencyKey: async () => 'idempotency-key',
        orderRequest: orderRequest(),
        paymentMethod: 'paystack',
        total: 4200,
        onVoucherRejected: vi.fn(),
        onPendingOrderInvalidated,
        onShippingRateRejected: vi.fn(),
        getOrderErrorMessage: () => 'Try again',
        request: vi.fn(async () => {
          throw new TypeError('network interrupted');
        }) as unknown as typeof fetch,
      })
    ).rejects.toThrow('network interrupted');

    expect(onPendingOrderInvalidated).not.toHaveBeenCalled();
  });

  it('falls back to the typed empty error payload when a failed response is not JSON', async () => {
    const getOrderErrorMessage = vi.fn(() => 'Try again');
    await expect(
      submitCheckoutOrder({
        resolvedPendingOrder: { reusableOrder: null, clearStoredOrder: false },
        getIdempotencyKey: async () => 'idempotency-key',
        orderRequest: orderRequest(),
        paymentMethod: 'paystack',
        total: 4200,
        onVoucherRejected: vi.fn(),
        onPendingOrderInvalidated: vi.fn(async () => undefined),
        onShippingRateRejected: vi.fn(),
        getOrderErrorMessage,
        request: vi.fn(
          async () => new Response('upstream unavailable', { status: 502 })
        ) as unknown as typeof fetch,
      })
    ).rejects.toThrow('Try again');

    expect(getOrderErrorMessage).toHaveBeenCalledWith({});
  });

  it('uses a server amount due and wallet result after creating an order', async () => {
    const request = vi.fn(async () =>
      response({
        order: { id: 'order-new', total: 5000, currency: 'NGN' },
        wallet: { amountUsed: 1000, newBalance: 250 },
        amountDueToGateway: 4000,
      })
    ) as unknown as typeof fetch;

    const result = await submitCheckoutOrder({
      resolvedPendingOrder: { reusableOrder: null, clearStoredOrder: false },
      getIdempotencyKey: async () => 'idempotency-key',
      orderRequest: orderRequest(),
      paymentMethod: 'paystack',
      total: 5000,
      onVoucherRejected: vi.fn(),
      onPendingOrderInvalidated: vi.fn(async () => undefined),
      onShippingRateRejected: vi.fn(),
      getOrderErrorMessage: () => 'Try again',
      request,
    });

    expect(result.amountDueToGateway).toBe(4000);
    expect(result.wallet).toEqual({ amountUsed: 1000, newBalance: 250 });
    expect(request).toHaveBeenCalledWith(
      '/api/orders',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'idempotency-key',
        }),
      })
    );
  });
  it.each([
    '<html>upstream error</html>',
    'null',
    '',
  ])('uses a safe error for an unreadable successful order response: %s', async (body) => {
    const onPendingOrderInvalidated = vi.fn(async () => undefined);
    const request = vi.fn(async () => new Response(body, { status: 200 }));
    await expect(
      submitCheckoutOrder({
        resolvedPendingOrder: { reusableOrder: null, clearStoredOrder: false },
        getIdempotencyKey: async () => 'retained-key',
        orderRequest: orderRequest(),
        paymentMethod: 'paystack',
        total: 5000,
        onVoucherRejected: vi.fn(),
        onPendingOrderInvalidated,
        onShippingRateRejected: vi.fn(),
        getOrderErrorMessage: () => 'Try again',
        request,
      })
    ).rejects.toThrow('Order creation failed');
    expect(onPendingOrderInvalidated).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    42,
    'error',
    [],
  ])('normalizes a non-object failed order response: %j', async (body) => {
    const onVoucherRejected = vi.fn((value: CheckoutOrderErrorData) => {
      selectRejectedVoucherLines([], value);
    });
    await expect(
      submitCheckoutOrder({
        resolvedPendingOrder: { reusableOrder: null, clearStoredOrder: false },
        getIdempotencyKey: async () => 'retained-key',
        orderRequest: orderRequest(),
        paymentMethod: 'paystack',
        total: 5000,
        onVoucherRejected,
        onPendingOrderInvalidated: vi.fn(async () => undefined),
        onShippingRateRejected: vi.fn(),
        getOrderErrorMessage: getCheckoutOrderErrorMessage,
        request: vi.fn(async () => response(body, 502)),
      })
    ).rejects.toThrow('Failed to create order');
    expect(onVoucherRejected).toHaveBeenCalledWith({});
  });
});

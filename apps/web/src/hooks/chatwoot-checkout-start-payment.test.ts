import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getChatwootCheckoutRememberedOrder,
  rememberChatwootCheckoutOrder,
  resetChatwootCheckoutOrderMemory,
} from './chatwoot-checkout-memory';
import {
  type StartChatwootCheckoutPaymentInput,
  startChatwootCheckoutPayment,
} from './chatwoot-checkout-start-payment';
import {
  checkoutPlaceRequest,
  dvaReady,
  paths,
  stubCheckoutFetch,
} from './chatwoot-checkout-test-fixtures';

const order = {
  orderId: 'order-uuid',
  orderNumber: 'ORD-1001',
  trackingToken: 'track-1' as string | null,
  amountDueMajor: 4650,
  currency: 'NGN' as string | null,
};

function input(
  overrides: Partial<StartChatwootCheckoutPaymentInput> = {}
): StartChatwootCheckoutPaymentInput {
  return {
    request: checkoutPlaceRequest,
    merchantId: 'merchant-1',
    storeSlug: 'store',
    order,
    orderKey: 'key-1',
    replacesExpiredDetails: false,
    canPost: () => true,
    postResult: vi.fn(),
    ...overrides,
  };
}
const track = (
  payment_status: string,
  extra: Record<string, unknown> = {}
) => ({
  body: { order: { id: 'order-uuid', payment_status, ...extra } },
});
const initCalls = (calls: { path: string }[]) =>
  paths(calls).filter((path) => path === '/api/payments/initialize');

beforeEach(() => {
  resetChatwootCheckoutOrderMemory();
  rememberChatwootCheckoutOrder(
    'key-1',
    { merchantId: 'merchant-1', conversationId: 905 },
    order
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('startChatwootCheckoutPayment', () => {
  it('issues bank details for a fresh order and remembers them', async () => {
    const { calls } = stubCheckoutFetch({
      '/api/payments/initialize': () => dvaReady,
    });
    const args = input();

    await startChatwootCheckoutPayment(args);

    expect(args.postResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'payment_ready',
        orderNumber: 'ORD-1001',
        amountMajor: 4650,
        reference: 'ref-123',
      })
    );
    expect(paths(calls)).toEqual(['/api/payments/initialize']);
    expect(
      getChatwootCheckoutRememberedOrder('key-1')?.payment?.reference
    ).toBe('ref-123');
  });

  it.each([
    ['no tracking token', { ...order, trackingToken: null }],
    ['a missing currency', { ...order, currency: null }],
    ['a non-naira currency', { ...order, currency: 'USD' }],
  ])('issues nothing for an order with %s', async (_label, unpayable) => {
    const { calls } = stubCheckoutFetch({
      '/api/payments/initialize': () => dvaReady,
    });
    const args = input({ order: unpayable });

    await startChatwootCheckoutPayment(args);

    expect(args.postResult).toHaveBeenCalledWith({
      requestId: checkoutPlaceRequest.requestId,
      status: 'failed',
      code: 'payment_unavailable',
      orderNumber: 'ORD-1001',
    });
    expect(calls).toHaveLength(0);
  });

  describe('replacing expired bank details', () => {
    it('reports the order paid and issues no second account when the transfer already landed', async () => {
      const { calls } = stubCheckoutFetch({
        '/api/storefront/orders/track-order': () => track('paid'),
        '/api/payments/initialize': () => dvaReady,
      });
      const args = input({ replacesExpiredDetails: true });

      await startChatwootCheckoutPayment(args);

      expect(args.postResult).toHaveBeenCalledWith({
        requestId: checkoutPlaceRequest.requestId,
        status: 'paid',
        orderNumber: 'ORD-1001',
      });
      expect(initCalls(calls)).toHaveLength(0);
    });

    it.each([
      ['cancelled', track('cancelled')],
      ['refunded', track('refunded')],
      [
        'shipping cancelled',
        track('pending', { shipping_status: 'cancelled' }),
      ],
      ['unreadable', { status: 500, body: {} }],
    ])('issues nothing when the order is %s', async (_label, response) => {
      const { calls } = stubCheckoutFetch({
        '/api/storefront/orders/track-order': () => response,
        '/api/payments/initialize': () => dvaReady,
      });
      const args = input({ replacesExpiredDetails: true });

      await startChatwootCheckoutPayment(args);

      expect(args.postResult).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          code: 'payment_unavailable',
          orderNumber: 'ORD-1001',
        })
      );
      expect(initCalls(calls)).toHaveLength(0);
    });

    it('issues new details when the order is still unpaid', async () => {
      const { calls } = stubCheckoutFetch({
        '/api/storefront/orders/track-order': () => track('pending'),
        '/api/payments/initialize': () => dvaReady,
      });
      const args = input({ replacesExpiredDetails: true });

      await startChatwootCheckoutPayment(args);

      expect(args.postResult).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'payment_ready' })
      );
      expect(initCalls(calls)).toHaveLength(1);
    });
  });

  it('remembers the details but stays silent when the frame is no longer current', async () => {
    stubCheckoutFetch({ '/api/payments/initialize': () => dvaReady });
    const args = input({ canPost: () => false });

    await startChatwootCheckoutPayment(args);

    expect(args.postResult).not.toHaveBeenCalled();
    expect(getChatwootCheckoutRememberedOrder('key-1')?.payment).not.toBeNull();
  });
});

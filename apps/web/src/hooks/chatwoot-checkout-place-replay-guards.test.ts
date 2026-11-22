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
  dvaReady,
  happyHandlers,
  lastResult,
  paths,
  placeInput,
  preparedCheckout,
  stubCheckoutFetch,
} from './chatwoot-checkout-test-fixtures';

beforeEach(() => {
  resetChatwootCheckoutOrderMemory();
  mocks.prepare.mockReset();
  mocks.prepare.mockResolvedValue(preparedCheckout());
});
afterEach(() => vi.unstubAllGlobals());

describe('handleChatwootCheckoutPlace', () => {
  describe('replay guards', () => {
    it('a repeat from a different conversation is refused and sets up no payment', async () => {
      const { calls } = stubCheckoutFetch(happyHandlers());
      await handleChatwootCheckoutPlace(placeInput());
      const paymentCalls = () =>
        paths(calls).filter((path) => path === '/api/payments/initialize');
      const before = paymentCalls().length;
      const other = placeInput({
        request: { ...checkoutPlaceRequest, conversationId: 906 },
      });

      await handleChatwootCheckoutPlace(other);

      expect(lastResult(other)).toEqual({
        requestId: checkoutPlaceRequest.requestId,
        status: 'failed',
        code: 'order_failed',
      });
      expect(paymentCalls()).toHaveLength(before);
      expect(
        paths(calls).filter((path) => path === '/api/orders')
      ).toHaveLength(1);
    });

    it('a repeat after the bank details expired sets payment up again and never returns the old details', async () => {
      let issued = 0;
      const { calls } = stubCheckoutFetch({
        ...happyHandlers(),
        // The order is read before expired details are replaced.
        '/api/storefront/orders/track-order': () => ({
          body: { order: { id: 'order-uuid', payment_status: 'pending' } },
        }),
        '/api/payments/initialize': () => {
          issued += 1;
          return {
            body: {
              ...dvaReady.body,
              reference: `ref-${issued}`,
              dva: {
                ...dvaReady.body.dva,
                account_number: `000000000${issued}`,
              },
            },
          };
        },
      });
      const first = placeInput();
      await handleChatwootCheckoutPlace(first);

      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 91 * 60 * 1000);
      const later = placeInput();
      await handleChatwootCheckoutPlace(later);
      vi.useRealTimers();

      expect(lastResult(first)).toMatchObject({
        status: 'payment_ready',
        reference: 'ref-1',
      });
      expect(lastResult(later)).toMatchObject({
        status: 'payment_ready',
        orderNumber: 'ORD-1001',
        reference: 'ref-2',
        bank: { accountNumber: '0000000002' },
      });
      expect(
        paths(calls).filter((path) => path === '/api/orders')
      ).toHaveLength(1);
    });

    it('a repeat for an order that has since been paid reports paid and shows no account again', async () => {
      let paid = false;
      const { calls } = stubCheckoutFetch({
        ...happyHandlers(),
        '/api/storefront/orders/track-order': () => ({
          body: {
            order: {
              id: 'order-uuid',
              payment_status: paid ? 'paid' : 'pending',
            },
          },
        }),
      });
      await handleChatwootCheckoutPlace(placeInput());
      paid = true;
      const repeat = placeInput();

      await handleChatwootCheckoutPlace(repeat);

      expect(lastResult(repeat)).toEqual({
        requestId: checkoutPlaceRequest.requestId,
        status: 'paid',
        orderNumber: 'ORD-1001',
      });
      expect(
        paths(calls).filter((path) => path === '/api/payments/initialize')
      ).toHaveLength(1);
    });
  });
});

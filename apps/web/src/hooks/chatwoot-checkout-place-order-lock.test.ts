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

/** Holds every network answer back a tick, so overlapping attempts overlap. */
function stubSlowCheckoutFetch(handlers: ReturnType<typeof happyHandlers>) {
  const stubbed = stubCheckoutFetch(handlers);
  const slow: typeof fetch = async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return stubbed.fetchMock(...(args as [string, RequestInit])) as never;
  };
  vi.stubGlobal('fetch', slow);
  return stubbed;
}

const count = (calls: { path: string }[], path: string) =>
  paths(calls).filter((entry) => entry === path).length;

describe('handleChatwootCheckoutPlace', () => {
  describe('one payment setup per order', () => {
    it('two copies of one request authorized against different carts place one order and set up payment once', async () => {
      const { calls } = stubSlowCheckoutFetch(happyHandlers());
      // Placing the order completes the cart, so a late copy of the same
      // request can be authorized against the cart that replaced it.
      const movedRef = { cartId: 'a-replacement-cart', version: 1 };
      const first = placeInput();
      const second = placeInput({
        authorizedCartId: movedRef.cartId,
        requestedCartRef: movedRef,
        getCurrentCartRef: () => movedRef,
      });

      const earlier = handleChatwootCheckoutPlace(first);
      // The later copy arrives while the earlier one is on the network.
      await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0), {
        interval: 1,
      });
      await Promise.all([earlier, handleChatwootCheckoutPlace(second)]);

      expect(lastResult(first)).toMatchObject({ status: 'payment_ready' });
      expect(lastResult(second)).toEqual(lastResult(first));
      expect(count(calls, '/api/orders')).toBe(1);
      expect(count(calls, '/api/payments/initialize')).toBe(1);
    });

    it('a retry of the first request and a new request on its cart share one payment setup', async () => {
      const paymentFails = { ...happyHandlers() };
      paymentFails['/api/payments/initialize'] = () => ({
        ok: false,
        status: 502,
        body: { error: 'unavailable' },
      });
      stubCheckoutFetch(paymentFails);
      const original = placeInput();
      await handleChatwootCheckoutPlace(original);
      expect(lastResult(original)).toMatchObject({
        status: 'failed',
        code: 'payment_unavailable',
      });

      const { calls } = stubSlowCheckoutFetch(happyHandlers());
      const movedRef = { cartId: 'a-replacement-cart', version: 1 };
      const retry = placeInput({
        authorizedCartId: movedRef.cartId,
        requestedCartRef: movedRef,
        getCurrentCartRef: () => movedRef,
      });
      const newer = placeInput({
        request: { ...placeInput().request, requestId: 'place-request-2' },
      });

      const earlier = handleChatwootCheckoutPlace(retry);
      // The later copy arrives while the earlier one is on the network.
      await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0), {
        interval: 1,
      });
      await Promise.all([earlier, handleChatwootCheckoutPlace(newer)]);

      expect(lastResult(retry)).toMatchObject({ status: 'payment_ready' });
      expect(lastResult(newer)).toMatchObject({
        requestId: 'place-request-2',
        status: 'payment_ready',
      });
      expect(count(calls, '/api/orders')).toBe(0);
      expect(count(calls, '/api/payments/initialize')).toBe(1);
    });
  });
});

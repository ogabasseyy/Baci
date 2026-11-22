import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));

vi.mock('@/hooks/cart/shared-cart-checkout-client', async (importActual) => ({
  ...(await importActual<
    typeof import('@/hooks/cart/shared-cart-checkout-client')
  >()),
  prepareSharedCartCheckout: mocks.prepare,
}));

vi.mock('./chatwoot-checkout-keys', () => ({
  // Derived without the crypto wait, so the attempts interleave predictably.
  deriveChatwootCheckoutKeys: async (
    requestId: string,
    merchantId: string
  ) => ({
    idempotencyKey: `cw-chk-test-${merchantId}-${requestId}`,
    operationId: `cw-op-test-${merchantId}-${requestId}`,
  }),
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

/**
 * Holds every network answer until `release()` is called, so a second attempt
 * can be started while the first is provably still on the network.
 */
function stubGatedCheckoutFetch(handlers: ReturnType<typeof happyHandlers>) {
  const stubbed = stubCheckoutFetch(handlers);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((open) => {
    release = open;
  });
  const gated: typeof fetch = async (...args) => {
    await gate;
    return stubbed.fetchMock(...(args as [string, RequestInit])) as never;
  };
  vi.stubGlobal('fetch', gated);
  return { ...stubbed, release };
}

/** Runs queued promise callbacks until both attempts are parked. */
async function settle() {
  for (let turn = 0; turn < 200; turn += 1) await Promise.resolve();
}

const count = (calls: { path: string }[], path: string) =>
  paths(calls).filter((entry) => entry === path).length;

describe('handleChatwootCheckoutPlace', () => {
  describe('one payment setup per order', () => {
    it('two copies of one request authorized against different carts place one order and set up payment once', async () => {
      const { calls, release } = stubGatedCheckoutFetch(happyHandlers());
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
      await settle();
      // The later copy arrives while the earlier one is still on the network.
      const later = handleChatwootCheckoutPlace(second);
      await settle();
      release();
      await Promise.all([earlier, later]);

      expect(lastResult(first)).toMatchObject({ status: 'payment_ready' });
      expect(lastResult(second)).toEqual(lastResult(first));
      expect(count(calls, '/api/orders')).toBe(1);
      expect(count(calls, '/api/payments/initialize')).toBe(1);
    });

    it('a retry of the first request and a new request on its cart share one payment setup', async () => {
      stubCheckoutFetch({
        ...happyHandlers(),
        '/api/payments/initialize': () => ({
          status: 502,
          body: { error: 'unavailable' },
        }),
      });
      const original = placeInput();
      await handleChatwootCheckoutPlace(original);
      expect(lastResult(original)).toMatchObject({
        status: 'failed',
        code: 'payment_unavailable',
      });

      const { calls, release } = stubGatedCheckoutFetch(happyHandlers());
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
      await settle();
      // The later copy arrives while the earlier one is still on the network.
      const later = handleChatwootCheckoutPlace(newer);
      await settle();
      release();
      await Promise.all([earlier, later]);

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

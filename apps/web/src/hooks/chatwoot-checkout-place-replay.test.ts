import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));

vi.mock('@/hooks/cart/shared-cart-checkout-client', async (importActual) => ({
  ...(await importActual<
    typeof import('@/hooks/cart/shared-cart-checkout-client')
  >()),
  prepareSharedCartCheckout: mocks.prepare,
}));

import { simulateChatwootCheckoutReload } from './chatwoot-checkout-memory';
import {
  handleChatwootCheckoutPlace,
  resetChatwootCheckoutOrderMemory,
} from './chatwoot-checkout-place-action';
import {
  CHECKOUT_CART_ID,
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
        getMerchant: () => ({
          id: 'another-merchant',
          taxRate: 0,
          bankTransferAvailable: true,
        }),
      });

      await handleChatwootCheckoutPlace(replay);

      // The key is merchant-scoped, so another merchant never reaches this
      // order's memory; the review for the first merchant's cart is refused.
      expect(lastResult(replay)).toMatchObject({ status: 'failed' });
      expect(
        paths(calls).filter((path) => path === '/api/payments/initialize')
      ).toHaveLength(paymentCallsBefore);
      expect(
        paths(calls).filter((path) => path === '/api/orders')
      ).toHaveLength(1);
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
          itemsSubtotalMinor: 200_000,
        },
        getCurrentCartRef: () => ({ cartId: CHECKOUT_CART_ID, version: 9 }),
      });

      await handleChatwootCheckoutPlace(retry);

      expect(lastResult(retry)).toMatchObject({ status: 'payment_ready' });
      expect(
        paths(calls).filter((path) => path === '/api/orders')
      ).toHaveLength(1);
    });

    it('after a page reload, a repeat returns the same order and bank details with no second order or payment setup', async () => {
      const { calls } = stubCheckoutFetch(happyHandlers());
      const first = placeInput();
      await handleChatwootCheckoutPlace(first);

      simulateChatwootCheckoutReload();
      // Creating the order completed the cart, so the reloaded page holds a
      // different cart at a different version.
      const movedRef = { cartId: 'a-replacement-cart', version: 1 };
      const afterReload = placeInput({
        requestedCartRef: movedRef,
        getCurrentCartRef: () => movedRef,
      });
      await handleChatwootCheckoutPlace(afterReload);

      expect(lastResult(afterReload)).toEqual(lastResult(first));
      expect(lastResult(afterReload)).toMatchObject({
        status: 'payment_ready',
      });
      expect(
        paths(calls).filter((path) => path === '/api/orders')
      ).toHaveLength(1);
      expect(
        paths(calls).filter((path) => path === '/api/payments/initialize')
      ).toHaveLength(1);
    });

    it('two copies of the same request arriving together set up payment once', async () => {
      const { calls } = stubCheckoutFetch(happyHandlers());
      const first = placeInput();
      const second = placeInput();

      await Promise.all([
        handleChatwootCheckoutPlace(first),
        handleChatwootCheckoutPlace(second),
      ]);

      expect(lastResult(first)).toMatchObject({ status: 'payment_ready' });
      expect(lastResult(second)).toEqual(lastResult(first));
      expect(
        paths(calls).filter((path) => path === '/api/orders')
      ).toHaveLength(1);
      expect(
        paths(calls).filter((path) => path === '/api/payments/initialize')
      ).toHaveLength(1);
    });
  });
});

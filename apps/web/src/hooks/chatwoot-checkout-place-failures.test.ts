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
  checkoutReview,
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

describe('handleChatwootCheckoutPlace failure codes', () => {
  it('cart_changed when the widget cart version is not the authorized one', async () => {
    const { fetchMock } = stubCheckoutFetch(happyHandlers());
    const input = placeInput({
      request: { ...checkoutPlaceRequest, cartVersion: 7 },
    });

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toEqual({
      requestId: 'place-request-1',
      status: 'failed',
      code: 'cart_changed',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cart_changed for estimated totals, a foreign cart or a moved live cart', async () => {
    const { fetchMock } = stubCheckoutFetch(happyHandlers());
    const estimated = placeInput({
      snapshot: {
        cartVersion: CHECKOUT_CART_VERSION,
        currency: 'NGN',
        estimatedTotals: true,
        itemsSubtotalMinor: 200_000,
      },
    });
    const foreign = placeInput({ authorizedCartId: 'cart-other' });
    const moved = placeInput({
      getCurrentCartRef: () => ({ cartId: CHECKOUT_CART_ID, version: 9 }),
    });

    for (const input of [estimated, foreign, moved]) {
      await handleChatwootCheckoutPlace(input);
      expect(lastResult(input)).toMatchObject({
        status: 'failed',
        code: 'cart_changed',
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cart_changed when the action was superseded before any side effect', async () => {
    const { fetchMock } = stubCheckoutFetch(happyHandlers());
    const input = placeInput({ isCurrent: () => false });

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'cart_changed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cart_changed when the review no longer matches the display cart', async () => {
    stubCheckoutFetch(happyHandlers());
    mocks.prepare.mockResolvedValue({
      ok: true,
      review: { ...checkoutReview, subtotalMinor: 250_000 },
      sessionExpiresAtMonotonicMs: 1,
      sessionExpiresAtEpochMs: 1,
      replayed: false,
      sessionReused: false,
    });
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'cart_changed' });
  });

  it('cart_changed when the prepared review is for another merchant or version', async () => {
    const { calls } = stubCheckoutFetch(happyHandlers());
    mocks.prepare.mockResolvedValue({
      ok: true,
      review: { ...checkoutReview, merchantId: 'merchant-other' },
      sessionExpiresAtMonotonicMs: 1,
      sessionExpiresAtEpochMs: 1,
      replayed: false,
      sessionReused: false,
    });
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'cart_changed' });
    expect(paths(calls)).not.toContain('/api/orders');
  });

  it('cart_changed when the prepare step asks for a refresh', async () => {
    stubCheckoutFetch(happyHandlers());
    mocks.prepare.mockResolvedValue({
      ok: false,
      code: 'refresh_required',
      retryable: false,
      currentVersion: 9,
    });
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'cart_changed' });
  });

  it('order_failed when the prepare step is temporarily unavailable', async () => {
    stubCheckoutFetch(happyHandlers());
    mocks.prepare.mockResolvedValue({
      ok: false,
      code: 'temporarily_unavailable',
      retryable: true,
      currentVersion: null,
    });
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'order_failed' });
  });

  it('delivery_unavailable for a non-NGN cart', async () => {
    const { fetchMock } = stubCheckoutFetch(happyHandlers());
    const input = placeInput({
      snapshot: {
        cartVersion: CHECKOUT_CART_VERSION,
        currency: 'USD',
        estimatedTotals: false,
        itemsSubtotalMinor: 200_000,
      },
    });

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'delivery_unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('details_invalid for an unusable phone number or a non-Nigerian state', async () => {
    const { fetchMock } = stubCheckoutFetch(happyHandlers());
    const badPhone = placeInput({
      request: {
        ...checkoutPlaceRequest,
        customer: { ...checkoutPlaceRequest.customer, phone: '12345678' },
      },
    });
    const badState = placeInput({
      request: {
        ...checkoutPlaceRequest,
        address: { ...checkoutPlaceRequest.address, state: 'Atlantis' },
      },
    });

    for (const input of [badPhone, badState]) {
      await handleChatwootCheckoutPlace(input);
      expect(lastResult(input)).toMatchObject({ code: 'details_invalid' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['quoting delivery', 'quotes'],
    ['preparing checkout', 'prepare'],
  ])('cart_changed with no order when the cart moves while %s', async (_label, step) => {
    let version = CHECKOUT_CART_VERSION;
    const { calls } = stubCheckoutFetch({
      ...happyHandlers(),
      '/api/shipping/quotes': () => {
        if (step === 'quotes') version += 1;
        return happyHandlers()['/api/shipping/quotes']();
      },
    });
    mocks.prepare.mockImplementation(() => {
      if (step === 'prepare') version += 1;
      return Promise.resolve(preparedCheckout());
    });
    const input = placeInput({
      getCurrentCartRef: () => ({ cartId: CHECKOUT_CART_ID, version }),
    });

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'cart_changed' });
    expect(paths(calls)).not.toContain('/api/orders');
    expect(mocks.prepare).toHaveBeenCalledTimes(step === 'quotes' ? 0 : 1);
  });
});

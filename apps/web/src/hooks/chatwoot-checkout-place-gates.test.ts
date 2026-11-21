import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));

vi.mock('@/hooks/cart/shared-cart-checkout-client', async (importActual) => ({
  ...(await importActual<
    typeof import('@/hooks/cart/shared-cart-checkout-client')
  >()),
  prepareSharedCartCheckout: mocks.prepare,
}));

import type { CartItem } from '@/hooks/cart';
import {
  handleChatwootCheckoutPlace,
  resetChatwootCheckoutOrderMemory,
} from './chatwoot-checkout-place-action';
import {
  checkoutDisplayCart,
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

const withLine = (overrides: Record<string, unknown>) =>
  [{ ...checkoutDisplayCart[0], ...overrides }] as unknown as CartItem[];

describe('chat checkout subtotal basis gate', () => {
  it.each([
    [
      'a negotiated line',
      withLine({ negotiatedPrice: 900, negotiationStatus: 'accepted' }),
      180_000,
    ],
    ['an assurance line', withLine({ hasAssurance: true }), 200_000],
  ])('refuses %s with no quote, prepare or order call', async (_label, cart, minor) => {
    const { fetchMock } = stubCheckoutFetch(happyHandlers());
    const input = placeInput({
      getDisplayCart: () => cart,
      snapshot: {
        cartVersion: 8,
        currency: 'NGN',
        estimatedTotals: false,
        itemsSubtotalMinor: minor,
      },
    });

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toEqual({
      requestId: 'place-request-1',
      status: 'failed',
      code: 'cart_unsupported',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('proceeds when the two bases are equal', async () => {
    stubCheckoutFetch(happyHandlers());
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ status: 'payment_ready' });
  });
});

describe('chat checkout bank transfer availability gate', () => {
  it('fails payment_unavailable before any quote, prepare or order call', async () => {
    const { fetchMock, calls } = stubCheckoutFetch(happyHandlers());
    const input = placeInput({
      getMerchant: () => ({
        id: 'merchant-1',
        taxRate: 0.075,
        bankTransferAvailable: false,
      }),
    });

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toEqual({
      requestId: 'place-request-1',
      status: 'failed',
      code: 'payment_unavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(paths(calls)).not.toContain('/api/orders');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('proceeds when bank transfer is available', async () => {
    stubCheckoutFetch(happyHandlers());
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ status: 'payment_ready' });
  });
});

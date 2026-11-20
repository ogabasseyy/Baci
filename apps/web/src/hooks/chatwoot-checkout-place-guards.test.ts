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
  CHECKOUT_CART_ID,
  checkoutDisplayCart,
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

const voucherCart = [
  { ...checkoutDisplayCart[0], quizAwardId: 'award-1', quizVoucherToken: 't' },
] as unknown as CartItem[];

describe('handleChatwootCheckoutPlace unsupported carts', () => {
  it('refuses a voucher line before quoting, preparing or posting anything', async () => {
    const { fetchMock } = stubCheckoutFetch(happyHandlers());
    const input = placeInput({ getDisplayCart: () => voucherCart });

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toEqual({
      requestId: 'place-request-1',
      status: 'failed',
      code: 'cart_unsupported',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('refuses a voucher the server review reports, with zero order posts', async () => {
    const { calls } = stubCheckoutFetch(happyHandlers());
    const [line] = checkoutReview.lines;
    mocks.prepare.mockResolvedValue(
      preparedCheckout({
        ...checkoutReview,
        lines: [{ ...line, voucherToken: 'tok', voucherAwardId: 'award-1' }],
      } as typeof checkoutReview)
    );
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'cart_unsupported' });
    expect(paths(calls)).not.toContain('/api/orders');
    expect(paths(calls)).not.toContain('/api/payments/initialize');
  });
});

describe('handleChatwootCheckoutPlace customer country', () => {
  it.each([
    ['a US number', '+14155552671'],
    ['a UK number', '+442071838750'],
  ])('refuses %s before any request or order', async (_label, phone) => {
    const { fetchMock } = stubCheckoutFetch(happyHandlers());
    const input = placeInput({
      request: {
        ...checkoutPlaceRequest,
        customer: { ...checkoutPlaceRequest.customer, phone },
      },
    });

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ code: 'details_invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('accepts a Nigerian +234 number', async () => {
    stubCheckoutFetch(happyHandlers());
    const input = placeInput();

    await handleChatwootCheckoutPlace(input);

    expect(lastResult(input)).toMatchObject({ status: 'payment_ready' });
  });
});

describe('handleChatwootCheckoutPlace delivery quote basis', () => {
  it('quotes on the cart subtotal the delivery options were shown for, not the catalog subtotal', async () => {
    const { calls } = stubCheckoutFetch(happyHandlers());
    // Display lines carry a catalog price of 1000 x 2; the authorized cart
    // (negotiated line) is 1800 in total.
    const input = placeInput({
      snapshot: {
        cartVersion: 8,
        currency: 'NGN',
        estimatedTotals: false,
        itemsSubtotalMinor: 180_000,
      },
    });

    await handleChatwootCheckoutPlace(input);

    expect(JSON.parse(String(calls[0]?.init.body)).cart_subtotal).toBe(1800);
  });
});

describe('handleChatwootCheckoutPlace idempotency key', () => {
  it('stays the same for a request id after the cart id has moved on', async () => {
    const { calls } = stubCheckoutFetch(happyHandlers());
    await handleChatwootCheckoutPlace(placeInput());
    resetChatwootCheckoutOrderMemory();
    const moved = { cartId: 'cart-after-completion', version: 8 };
    mocks.prepare.mockResolvedValue(
      preparedCheckout({ ...checkoutReview, cartId: moved.cartId })
    );

    await handleChatwootCheckoutPlace(
      placeInput({
        authorizedCartId: moved.cartId,
        requestedCartRef: moved,
        getCurrentCartRef: () => moved,
      })
    );

    expect(CHECKOUT_CART_ID).not.toBe(moved.cartId);
    const keys = calls
      .filter((call) => call.path === '/api/orders')
      .map(
        (call) =>
          (call.init.headers as Record<string, string>)['Idempotency-Key']
      );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});

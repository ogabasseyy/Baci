import { cartLineIdentity } from '@baci/shared/cart';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetCartSessionHintForTests,
  writeCartSessionHint,
} from './cart-session-hint';
import {
  saveCartToStorage,
  stripUnconfirmedDisplayLines,
} from './cart-storage';
import {
  fetchSharedCartProducts,
  sendSharedCartCommand,
} from './shared-cart-client';
import { confirmedLineToDisplay } from './shared-cart-display';
import {
  CART_ID,
  cartItem,
  cartLine,
  MERCHANT_ID,
  mockAdopted,
  product,
  SLUG,
} from './use-cart-link-lifecycle.test-support';
import { useSharedCart } from './use-shared-cart';

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));

describe('useSharedCart cached handoff hydration', () => {
  afterEach(() => {
    resetCartSessionHintForTests();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetCartSessionHintForTests();
    writeCartSessionHint(MERCHANT_ID, '1');
  });

  it.each([
    'Unavailable item',
    'Cached product',
  ])('rechecks an older confirmed entry labelled %s', async (cachedName) => {
    saveCartToStorage(
      [
        cartItem({
          cartItemId: 'line-1',
          image: '',
          imageLarge: '',
          name: cachedName,
          serverLineId: 'line-1',
          slug: 'prod-1',
        }),
      ],
      SLUG
    );
    mockAdopted();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(
      new Map([['prod-1', product({ name: 'Xiaomi Smart Camera C300' })]])
    );

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    await waitFor(() =>
      expect(result.current.cart[0]).toMatchObject({
        name: 'Xiaomi Smart Camera C300',
        quantity: 1,
        serverLineId: 'line-1',
      })
    );
    expect(sendSharedCartCommand).not.toHaveBeenCalled();
  });

  it('reloads a marked placeholder even if its display fields change', async () => {
    const cached = confirmedLineToDisplay(cartLine(), {});
    saveCartToStorage(
      stripUnconfirmedDisplayLines([{ ...cached, name: 'Loading product' }]),
      SLUG
    );
    mockAdopted();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(
      new Map([['prod-1', product({ name: 'Xiaomi Smart Camera C300' })]])
    );

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    await waitFor(() =>
      expect(result.current.cart[0]).toMatchObject({
        name: 'Xiaomi Smart Camera C300',
        quantity: 1,
        serverLineId: 'line-1',
      })
    );
    expect(sendSharedCartCommand).not.toHaveBeenCalled();
  });

  it('uses a marked catalog product even if it looks like an old placeholder', async () => {
    const line = cartLine();
    const catalogProduct = product({
      image: '',
      imageLarge: '',
      name: 'Unavailable item',
      slug: 'prod-1',
    });
    saveCartToStorage(
      stripUnconfirmedDisplayLines([
        confirmedLineToDisplay(line, {
          [cartLineIdentity(line.item)]: catalogProduct,
        }),
      ]),
      SLUG
    );
    mockAdopted();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    await waitFor(() => expect(result.current.cartId).toBe(CART_ID));
    expect(result.current.cart[0]?.hydrationFailed).toBeUndefined();
    expect(fetchSharedCartProducts).not.toHaveBeenCalled();
  });
});

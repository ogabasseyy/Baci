import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetCartSessionHintForTests,
  writeCartSessionHint,
} from './cart-session-hint';
import { saveCartToStorage } from './cart-storage';
import {
  fetchSharedCartProducts,
  sendSharedCartCommand,
} from './shared-cart-client';
import {
  cartItem,
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

  it('reloads catalog details for a cached fallback from a handoff', async () => {
    saveCartToStorage(
      [
        cartItem({
          cartItemId: 'line-1',
          image: '',
          imageLarge: '',
          name: 'Unavailable item',
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
});

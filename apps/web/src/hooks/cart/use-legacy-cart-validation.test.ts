import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from './cart-types';
import { useLegacyCartValidation } from './use-legacy-cart-validation';

const validateStorefrontCart = vi.hoisted(() => vi.fn());
const applyValidationResults = vi.hoisted(() => vi.fn());
const createCartHash = vi.hoisted(() =>
  vi.fn((cart: unknown[]) => `h${cart.length}`)
);

vi.mock('./storefront-cart-validation', () => ({
  applyValidationResults,
  createCartHash,
  validateStorefrontCart,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

const item = { cartItemId: 'line-1', price: 100, quantity: 1 } as CartItem;

function setup(overrides: Record<string, unknown> = {}) {
  const setCart = vi.fn();
  const setCartWideNegotiationActiveState = vi.fn();
  const cartWideNegotiationActiveRef = { current: false };
  renderHook(() =>
    useLegacyCartValidation({
      cart: [item],
      cartWideNegotiationActive: false,
      delegated: false,
      isHydrated: true,
      isValidationActivated: true,
      setCart,
      setCartWideNegotiationActiveState,
      cartWideNegotiationActiveRef,
      ...overrides,
    } as never)
  );
  return { setCart, setCartWideNegotiationActiveState };
}

describe('useLegacyCartValidation', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('applies validation results after the debounce', async () => {
    vi.useFakeTimers();
    validateStorefrontCart.mockResolvedValue({
      priceChanges: [],
      invalidProductIds: [],
    });
    applyValidationResults.mockImplementation((cart: CartItem[]) => cart);
    const { setCart } = setup();
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(validateStorefrontCart).toHaveBeenCalled();
    expect(setCart).toHaveBeenCalled();
  });

  it('skips validation while delegated', async () => {
    vi.useFakeTimers();
    setup({ delegated: true });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(validateStorefrontCart).not.toHaveBeenCalled();
  });

  it('does not set cart when validation fails', async () => {
    vi.useFakeTimers();
    validateStorefrontCart.mockRejectedValue(new Error('offline'));
    const { setCart } = setup();
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(setCart).not.toHaveBeenCalled();
  });
});

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStorefrontCartLineHandlers } from './use-storefront-cart-line-handlers';

const { mockTrackCartAdd } = vi.hoisted(() => ({
  mockTrackCartAdd: vi.fn(),
}));

vi.mock('./track-cart-add', () => ({ trackCartAdd: mockTrackCartAdd }));

const product = { id: 'prod-1', price: 100, name: 'Phone' } as never;
const merchant = { id: 'merchant-1', slug: 'ogabassey', country: 'NG' };

function setup(overrides: Record<string, unknown> = {}) {
  const delegatedActions = {
    addToCart: vi.fn(() => 1),
    removeFromCart: vi.fn(),
    updateQuantity: vi.fn(),
  };
  const { result } = renderHook(() =>
    useStorefrontCartLineHandlers({
      cartRef: { current: [] },
      cartWideNegotiationActiveRef: { current: false },
      delegated: false,
      delegatedActions,
      enableSmartCartPro: false,
      merchantContext: { merchant },
      merchantSlugRef: { current: 'ogabassey' },
      setCart: vi.fn(),
      setCartWideNegotiationActive: vi.fn(),
      setLastAddedProduct: vi.fn(),
      setShowUpsell: vi.fn(),
      upsellTimerRef: { current: null },
      ...overrides,
    } as never)
  );
  return { result, delegatedActions };
}

describe('bugfix: storefront add-to-cart was only tracked on the default PDP', () => {
  beforeEach(() => {
    mockTrackCartAdd.mockReset();
  });

  it('tracks an applied legacy-cart add exactly once from the shared cart action', () => {
    const { result } = setup();

    const outcome = result.current.addToCart(product, 2);

    expect(outcome).toBe('applied');
    expect(mockTrackCartAdd).toHaveBeenCalledTimes(1);
    expect(mockTrackCartAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant,
        product: expect.objectContaining({ id: 'prod-1' }),
        quantity: 2,
      })
    );
  });

  it('tracks an accepted shared-cart (delegated) add exactly once', () => {
    const { result } = setup({ delegated: true });

    result.current.addToCart(product, 1);

    expect(mockTrackCartAdd).toHaveBeenCalledTimes(1);
  });

  it('does not track an add the shared cart rejects', () => {
    const delegatedActions = {
      addToCart: vi.fn(() => 0),
      removeFromCart: vi.fn(),
      updateQuantity: vi.fn(),
    };
    const { result } = setup({ delegated: true, delegatedActions });

    expect(result.current.addToCart(product, 1)).toBe('rejected');
    expect(mockTrackCartAdd).not.toHaveBeenCalled();
  });

  it('does not track an add the stock guard rejects', () => {
    const { result } = setup();
    const soldOut = {
      id: 'prod-2',
      name: 'Sold out',
      price: 100,
      manage_stock: true,
      stock: 0,
    } as never;

    expect(result.current.addToCart(soldOut, 1)).toBe('rejected');
    expect(mockTrackCartAdd).not.toHaveBeenCalled();
  });

  it('tracks the clamped quantity a shared cart actually sent', () => {
    const delegatedActions = {
      addToCart: vi.fn(() => 2),
      removeFromCart: vi.fn(),
      updateQuantity: vi.fn(),
    };
    const { result } = setup({ delegated: true, delegatedActions });

    result.current.addToCart(product, 5);

    expect(mockTrackCartAdd).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 2 })
    );
  });

  it('tracks the units an offer stock cap actually let into the legacy cart', () => {
    const { result } = setup();
    const limited = {
      id: 'prod-3',
      name: 'Limited',
      price: 100,
      manage_stock: true,
      stock: 2,
    } as never;

    expect(
      result.current.addToCart(limited, 5, {
        condition: 'used',
        offerId: 'offer-1',
      })
    ).toBe('applied');
    expect(mockTrackCartAdd).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 2 })
    );
  });
});

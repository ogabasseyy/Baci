import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckoutRedvaultAvailability } from './use-checkout-redvault-availability';

const { mockUseAvailability, mockUseCustomerSession } = vi.hoisted(() => ({
  mockUseAvailability: vi.fn(),
  mockUseCustomerSession: vi.fn(),
}));

vi.mock('./use-redvault-payment-availability', () => ({
  useRedvaultPaymentAvailability: mockUseAvailability,
}));

vi.mock('./use-storefront-customer-session', () => ({
  useStorefrontCustomerSession: mockUseCustomerSession,
}));

const waitForResolvedAuthenticated = vi.fn();

describe('useCheckoutRedvaultAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCustomerSession.mockReturnValue({
      revision: 4,
      status: 'authenticated',
      waitForResolvedAuthenticated,
    });
    mockUseAvailability.mockReturnValue({ available: true, reason: 'private_live_pilot' });
  });

  it('passes the sole quantity-one nonvariant item and current auth revision', () => {
    const cartItems = [{ id: 'pilot-product', quantity: 1 }];
    const { result } = renderHook(() =>
      useCheckoutRedvaultAvailability({
        cartItems,
        merchantId: 'merchant',
        merchantSlug: 'store',
        userId: 'customer',
      })
    );

    expect(mockUseCustomerSession).toHaveBeenCalledWith('store');
    expect(mockUseAvailability).toHaveBeenCalledWith(
      'merchant',
      'pilot-product',
      'customer:authenticated:4:pilot-product:1:'
    );
    expect(result.current.availability.available).toBe(true);
    expect(result.current.waitForResolvedAuthenticated).toBe(
      waitForResolvedAuthenticated
    );
  });

  it('changes the request identity after a same-status auth revision', () => {
    const { rerender } = renderHook(
      ({ revision }: { revision: number }) => {
        mockUseCustomerSession.mockReturnValue({
          revision,
          status: 'authenticated',
          waitForResolvedAuthenticated,
        });
        return useCheckoutRedvaultAvailability({
          cartItems: [{ id: 'pilot-product', quantity: 1 }],
          merchantId: 'merchant',
          merchantSlug: 'store',
          userId: null,
        });
      },
      { initialProps: { revision: 8 } }
    );

    const firstKey = mockUseAvailability.mock.calls.at(-1)?.[2];
    rerender({ revision: 9 });
    const updatedKey = mockUseAvailability.mock.calls.at(-1)?.[2];

    expect(firstKey).toBe(':authenticated:8:pilot-product:1:');
    expect(updatedKey).toBe(':authenticated:9:pilot-product:1:');
    expect(updatedKey).not.toBe(firstKey);
  });

  it('omits product eligibility for multi-line, quantity-many, and variant carts', () => {
    const cases = [
      [
        { id: 'pilot-product', quantity: 1 },
        { id: 'other-product', quantity: 1 },
      ],
      [{ id: 'pilot-product', quantity: 2 }],
      [{ id: 'pilot-product', quantity: 1, variantId: 'variant' }],
    ];

    for (const cartItems of cases) {
      renderHook(() =>
        useCheckoutRedvaultAvailability({
          cartItems,
          merchantId: 'merchant',
          merchantSlug: 'store',
        })
      );
    }

    expect(mockUseAvailability.mock.calls.map(([, productId]) => productId)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

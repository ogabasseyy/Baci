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
      accountId: 'customer',
      revision: 4,
      status: 'authenticated',
      waitForResolvedAuthenticated,
    });
    mockUseAvailability.mockReturnValue({ available: true, reason: 'private_live_pilot' });
  });

  it('passes the sole quantity-one nonvariant item and current auth revision', () => {
    const cartItems = [
      { id: '11111111-1111-4111-8111-111111111111', quantity: 1 },
    ];
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
      '11111111-1111-4111-8111-111111111111',
      'customer:authenticated:4:11111111-1111-4111-8111-111111111111:1:',
      'customer:customer:11111111-1111-4111-8111-111111111111:1:'
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
          accountId: 'customer',
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
    const firstIdentity = mockUseAvailability.mock.calls.at(-1)?.[3];
    rerender({ revision: 9 });
    const updatedKey = mockUseAvailability.mock.calls.at(-1)?.[2];
    const updatedIdentity = mockUseAvailability.mock.calls.at(-1)?.[3];

    expect(firstKey).toBe(':authenticated:8:pilot-product:1:');
    expect(updatedKey).toBe(':authenticated:9:pilot-product:1:');
    expect(updatedKey).not.toBe(firstKey);
    // Same-user session churn refetches but keeps the stable identity, so
    // the last result stays served while revalidating.
    expect(firstIdentity).toBe(':customer:pilot-product:1:');
    expect(updatedIdentity).toBe(firstIdentity);
  });

  it('changes the stable identity when the session account changes', () => {
    const { rerender } = renderHook(
      ({ accountId }: { accountId: string | null }) => {
        mockUseCustomerSession.mockReturnValue({
          accountId,
          revision: 8,
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
      { initialProps: { accountId: 'customer' as string | null } }
    );

    const firstIdentity = mockUseAvailability.mock.calls.at(-1)?.[3];
    rerender({ accountId: null });
    const updatedIdentity = mockUseAvailability.mock.calls.at(-1)?.[3];

    expect(firstIdentity).toBe(':customer:pilot-product:1:');
    expect(updatedIdentity).toBe('::pilot-product:1:');
  });

  it.each([
    ['assurance', { hasAssurance: true, shippingFee: 0, giftWrappingCost: 0 }],
    ['shipping', { hasAssurance: false, shippingFee: 1500, giftWrappingCost: 0 }],
    ['gift wrapping', { hasAssurance: false, shippingFee: 0, giftWrappingCost: 500 }],
  ])('hides a pilot result when %s applies', (_label, pilotFeeBlockers) => {
    const { result } = renderHook(() =>
      useCheckoutRedvaultAvailability({
        cartItems: [{ id: 'pilot-product', quantity: 1 }],
        merchantId: 'merchant',
        merchantSlug: 'store',
        pilotFeeBlockers,
      })
    );

    expect(result.current.availability).toEqual({
      available: false,
      reason: 'unavailable',
    });
  });

  it('keeps pilot results without fees and non-pilot results with fees', () => {
    const pilotCart = [{ id: 'pilot-product', quantity: 1 }];
    const fees = { hasAssurance: true, shippingFee: 1500, giftWrappingCost: 500 };

    const pilot = renderHook(() =>
      useCheckoutRedvaultAvailability({
        cartItems: pilotCart,
        merchantId: 'merchant',
        merchantSlug: 'store',
        pilotFeeBlockers: { hasAssurance: false, shippingFee: 0, giftWrappingCost: 0 },
      })
    );
    expect(pilot.result.current.availability).toEqual({
      available: true,
      reason: 'private_live_pilot',
    });

    mockUseAvailability.mockReturnValue({
      available: true,
      reason: 'staging_test_mode',
    });
    const staged = renderHook(() =>
      useCheckoutRedvaultAvailability({
        cartItems: pilotCart,
        merchantId: 'merchant',
        merchantSlug: 'store',
        pilotFeeBlockers: fees,
      })
    );
    expect(staged.result.current.availability).toEqual({
      available: true,
      reason: 'staging_test_mode',
    });
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

  it('reuses a caller-provided session instead of mounting a second one', () => {
    const cartItems = [
      { id: '11111111-1111-4111-8111-111111111111', quantity: 1 },
    ];
    const { result } = renderHook(() =>
      useCheckoutRedvaultAvailability({
        cartItems,
        merchantId: 'merchant',
        merchantSlug: 'store',
        userId: 'customer',
        customerSession: {
          accountId: 'account-9',
          isAuthenticated: true,
          revision: 7,
          status: 'authenticated',
          waitForResolvedAuthenticated,
        },
      })
    );

    expect(mockUseCustomerSession).toHaveBeenCalledWith(undefined);
    expect(mockUseAvailability).toHaveBeenCalledWith(
      'merchant',
      '11111111-1111-4111-8111-111111111111',
      'customer:authenticated:7:11111111-1111-4111-8111-111111111111:1:',
      'customer:account-9:11111111-1111-4111-8111-111111111111:1:'
    );
    expect(result.current.waitForResolvedAuthenticated).toBe(
      waitForResolvedAuthenticated
    );
  });
});

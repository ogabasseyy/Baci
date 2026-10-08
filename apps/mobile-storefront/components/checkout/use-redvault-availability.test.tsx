import { act, renderHook } from '@testing-library/react-native';
import type { CartItem } from '@/stores/cart-store';
import { useRedvaultAvailability } from './use-redvault-availability';

const mockGetAvailability = jest.fn<
  Promise<{ available: boolean; reason: string; expiresAt?: number }>,
  [merchantId: string, productId?: string]
>();

jest.mock('@/services/redvault', () => ({
  getRedvaultPaymentAvailability: (merchantId: string, productId?: string) =>
    mockGetAvailability(merchantId, productId),
}));

const merchantId = 'merchant-1';
const item: CartItem = {
  id: 'line-1',
  name: 'Phone',
  price: 10_000,
  product_id: 'product-1',
  quantity: 1,
  slug: 'phone',
};
const items: CartItem[] = [item];

describe('useRedvaultAvailability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAvailability.mockResolvedValue({
      available: true,
      reason: 'private_live_pilot',
    });
  });

  it('includes only a sole quantity-one nonvariant item and hides account changes pending refresh', async () => {
    const { result, rerender } = renderHook(
      ({ customerId }: { customerId: string }) =>
        useRedvaultAvailability({
          customerId,
          isAuthenticated: true,
          items,
          merchantId,
        }),
      { initialProps: { customerId: 'customer-a' } }
    );

    expect(mockGetAvailability).toHaveBeenCalledWith(merchantId, 'product-1');
    await act(async () => undefined);
    expect(result.current).toBe(true);

    mockGetAvailability.mockReturnValue(
      new Promise<{ available: boolean; reason: string }>(() => undefined)
    );
    rerender({ customerId: 'customer-b' });
    expect(result.current).toBe(false);
    expect(mockGetAvailability).toHaveBeenLastCalledWith(
      merchantId,
      'product-1'
    );
  });

  it('fails closed when availability rejects', async () => {
    mockGetAvailability.mockRejectedValue(new Error('Unavailable'));
    const { result } = renderHook(() =>
      useRedvaultAvailability({
        customerId: 'customer-a',
        isAuthenticated: true,
        items,
        merchantId,
      })
    );

    await act(async () => undefined);
    expect(result.current).toBe(false);
  });

  it.each([
    {
      cartItems: [
        { ...item, id: 'line-1', product_id: 'product-1' },
        { ...item, id: 'line-2', product_id: 'product-2' },
      ],
    },
    { cartItems: [{ ...item, quantity: 2 }] },
    { cartItems: [{ ...item, variant_id: 'variant-1' }] },
  ])('omits product scope for an ineligible cart shape', async ({
    cartItems,
  }) => {
    renderHook(() =>
      useRedvaultAvailability({
        isAuthenticated: false,
        items: cartItems,
        merchantId,
      })
    );

    await act(async () => undefined);
    expect(mockGetAvailability).toHaveBeenCalledWith(merchantId, undefined);
  });

  it.each([
    ['assurance', { assuranceFee: 500, deliveryFee: 0 }],
    ['delivery', { assuranceFee: 0, deliveryFee: 1500 }],
  ])('hides a pilot result when %s fees apply', async (_label, fees) => {
    const { result } = renderHook(() =>
      useRedvaultAvailability({
        ...fees,
        customerId: 'customer-a',
        isAuthenticated: true,
        items,
        merchantId,
      })
    );

    await act(async () => undefined);
    expect(result.current).toBe(false);
  });

  it('keeps pilot results without fees and non-pilot results with fees', async () => {
    const { result: pilot } = renderHook(() =>
      useRedvaultAvailability({
        assuranceFee: 0,
        customerId: 'customer-a',
        deliveryFee: 0,
        isAuthenticated: true,
        items,
        merchantId,
      })
    );

    await act(async () => undefined);
    expect(pilot.current).toBe(true);

    mockGetAvailability.mockResolvedValue({
      available: true,
      reason: 'staging_test_mode',
    });
    const { result: staged } = renderHook(() =>
      useRedvaultAvailability({
        assuranceFee: 500,
        customerId: 'customer-a',
        deliveryFee: 1500,
        isAuthenticated: true,
        items,
        merchantId,
      })
    );

    await act(async () => undefined);
    expect(staged.current).toBe(true);
  });

  it('hides a repriced basket pending refresh', async () => {
    const { result, rerender } = renderHook(
      ({ unitPrice }: { unitPrice: number }) =>
        useRedvaultAvailability({
          customerId: 'customer-a',
          isAuthenticated: true,
          items: [{ ...item, price: unitPrice }],
          merchantId,
        }),
      { initialProps: { unitPrice: 10_000 } }
    );

    await act(async () => undefined);
    expect(result.current).toBe(true);

    mockGetAvailability.mockReturnValue(
      new Promise<{ available: boolean; reason: string }>(() => undefined)
    );
    rerender({ unitPrice: 12_000 });
    expect(result.current).toBe(false);
    expect(mockGetAvailability).toHaveBeenLastCalledWith(
      merchantId,
      'product-1'
    );
  });

  it('revalidates and hides once the pilot expiry passes', async () => {
    jest.useFakeTimers();
    try {
      mockGetAvailability
        .mockResolvedValueOnce({
          available: true,
          reason: 'private_live_pilot',
          expiresAt: Date.now() + 1000,
        })
        .mockResolvedValueOnce({ available: false, reason: 'unavailable' });
      const { result } = renderHook(() =>
        useRedvaultAvailability({
          customerId: 'customer-a',
          isAuthenticated: true,
          items,
          merchantId,
        })
      );

      await act(async () => undefined);
      expect(result.current).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      await act(async () => undefined);
      expect(result.current).toBe(false);
      expect(mockGetAvailability).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['an accepted negotiation', { negotiationStatus: 'accepted' as const }],
    ['a below-price negotiation without status', { negotiatedPrice: 9_000 }],
  ])('hides every reason when a cart carries %s', async (_label, negotiation) => {
    for (const reason of ['private_live_pilot', 'general']) {
      mockGetAvailability.mockResolvedValue({ available: true, reason });
      const { result } = renderHook(() =>
        useRedvaultAvailability({
          customerId: 'customer-a',
          isAuthenticated: true,
          items: [{ ...item, ...negotiation }],
          merchantId,
        })
      );

      await act(async () => undefined);
      expect(result.current).toBe(false);
    }
  });

  it('keeps results when the negotiated price equals the line price', async () => {
    const { result } = renderHook(() =>
      useRedvaultAvailability({
        customerId: 'customer-a',
        isAuthenticated: true,
        items: [{ ...item, negotiatedPrice: 10_000 }],
        merchantId,
      })
    );

    await act(async () => undefined);
    expect(result.current).toBe(true);
  });
});

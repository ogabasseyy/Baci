import { act, renderHook } from '@testing-library/react-native';
import type { CartItem } from '@/stores/cart-store';
import { useRedvaultAvailability } from './use-redvault-availability';

const mockGetAvailability = jest.fn<
  Promise<boolean>,
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
    mockGetAvailability.mockResolvedValue(true);
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

    mockGetAvailability.mockReturnValue(new Promise<boolean>(() => undefined));
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
});

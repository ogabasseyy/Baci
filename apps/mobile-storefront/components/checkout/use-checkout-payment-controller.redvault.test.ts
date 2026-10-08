import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { CartItem } from '@/stores/cart-store';
import { useCheckoutPaymentController } from './use-checkout-payment-controller';

const mockCalculateCommerce = jest.fn();
const mockGetRedvaultPaymentAvailability =
  jest.fn<
    (...args: unknown[]) => Promise<{ available: boolean; reason: string }>
  >();
let mockEnabledPaymentMethods = ['paystack', 'bank_transfer'];

jest.mock('@/hooks/use-checkout-savings', () => ({
  useCheckoutSavings: () => ({
    checkoutSavingsBalance: 0,
    getLiveSavingsSelection: () => undefined,
    savingsSelection: undefined,
  }),
}));

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({ data: undefined }),
}));

jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  getEnabledPaymentMethods: () => mockEnabledPaymentMethods,
  getMerchantTaxRate: () => 0,
  useMerchantPaymentSettings: () => ({
    data: {
      paystack_enabled: true,
      wallet_order_auto_debit_enabled: false,
      wallet_paystack_dva_enabled: false,
    },
  }),
}));

jest.mock('@/lib/commerce-brain', () => ({
  calculateCommerce: (...args: unknown[]) => mockCalculateCommerce(...args),
}));

jest.mock('@/services/redvault', () => ({
  getRedvaultPaymentAvailability: (...args: unknown[]) =>
    mockGetRedvaultPaymentAvailability(...args),
}));

const items: CartItem[] = [
  {
    id: 'line-1',
    name: 'iPhone 13',
    price: 500_000,
    product_id: 'product-1',
    quantity: 1,
    slug: 'iphone-13',
  },
];

describe('useCheckoutPaymentController REDVAULT cart and fee scenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnabledPaymentMethods = ['paystack', 'bank_transfer'];
    mockCalculateCommerce.mockImplementation(() =>
      Promise.reject(new Error('offline'))
    );
    mockGetRedvaultPaymentAvailability.mockReturnValue(
      new Promise<{ available: boolean; reason: string }>(() => undefined)
    );
  });

  it('passes only a single nonvariant quantity-one product and hides stale results on cart changes', async () => {
    let resolveAvailability: (value: {
      available: boolean;
      reason: string;
    }) => void = () => {};
    mockGetRedvaultPaymentAvailability.mockImplementationOnce(
      () =>
        new Promise<{ available: boolean; reason: string }>((resolve) => {
          resolveAvailability = resolve;
        })
    );
    const { result, rerender } = renderHook<
      ReturnType<typeof useCheckoutPaymentController>,
      { items: typeof items }
    >(
      ({ items: cartItems }) =>
        useCheckoutPaymentController({
          assuranceFee: 0,
          deliveryFee: 0,
          isAuthenticated: false,
          items: cartItems,
          merchantId: 'merchant-1',
          merchantSlug: 'ogabassey',
          step: 'payment',
          subtotal: 500000,
        }),
      { initialProps: { items } }
    );
    expect(mockGetRedvaultPaymentAvailability).toHaveBeenCalledWith(
      'merchant-1',
      'product-1'
    );
    resolveAvailability({ available: true, reason: 'private_live_pilot' });
    await act(async () => undefined);
    expect(result.current.redvaultAvailable).toBe(true);

    const firstItem = items[0];
    if (!firstItem) throw new Error('Expected a cart fixture');
    rerender({
      items: [
        ...items,
        { ...firstItem, id: 'line-2', product_id: 'product-2' },
      ],
    });
    expect(result.current.redvaultAvailable).toBe(false);
    expect(mockGetRedvaultPaymentAvailability).toHaveBeenLastCalledWith(
      'merchant-1',
      undefined
    );
  });

  it('hides pilot REDVAULT and clears its selection when fees apply', async () => {
    mockGetRedvaultPaymentAvailability.mockResolvedValue({
      available: true,
      reason: 'private_live_pilot',
    });
    const { result } = renderHook(() =>
      useCheckoutPaymentController({
        assuranceFee: 500,
        deliveryFee: 0,
        isAuthenticated: false,
        items,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        step: 'payment',
        subtotal: 500_000,
      })
    );

    await act(async () => undefined);
    expect(result.current.redvaultAvailable).toBe(false);
    expect(result.current.availablePaymentMethods).not.toContain(
      'uba_redvault'
    );
  });
});

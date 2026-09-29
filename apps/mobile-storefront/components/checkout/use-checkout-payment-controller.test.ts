import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { CartItem } from '@/stores/cart-store';
import { useCheckoutPaymentController } from './use-checkout-payment-controller';

const mockCalculateCommerce = jest.fn();
const mockGetRedvaultPaymentAvailability =
  jest.fn<(...args: unknown[]) => Promise<boolean>>();
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

describe('useCheckoutPaymentController selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnabledPaymentMethods = ['paystack', 'bank_transfer'];
    mockCalculateCommerce.mockImplementation(() =>
      Promise.reject(new Error('offline'))
    );
    mockGetRedvaultPaymentAvailability.mockReturnValue(
      new Promise<boolean>(() => undefined)
    );
  });

  it('starts unselected and only selects an instrument after an intent opens', () => {
    const { result } = renderHook(() =>
      useCheckoutPaymentController({
        assuranceFee: 0,
        deliveryFee: 5_000,
        isAuthenticated: false,
        items,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        step: 'payment',
        subtotal: 500_000,
      })
    );

    expect(result.current.paymentTab).toBeNull();
    expect(result.current.selectedPayment).toBeNull();

    act(() => result.current.handleSelectPaymentTab('full'));
    expect(result.current.paymentTab).toBe('full');
    expect(result.current.selectedPayment).toBeNull();

    act(() => result.current.setSelectedPayment('paystack'));
    expect(result.current.selectedPayment).toBe('paystack');
    expect(result.current.paymentTab).toBe('full');

    act(() => result.current.resetPaymentSelection());
    expect(result.current.paymentTab).toBeNull();
    expect(result.current.selectedPayment).toBeNull();
  });

  it('selects REDVAULT only after the server availability result succeeds', async () => {
    mockGetRedvaultPaymentAvailability.mockResolvedValue(true);
    const { result } = renderHook(() =>
      useCheckoutPaymentController({
        assuranceFee: 0,
        deliveryFee: 5_000,
        isAuthenticated: false,
        items,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        step: 'payment',
        subtotal: 500_000,
      })
    );

    await act(async () => undefined);
    expect(result.current.redvaultAvailable).toBe(true);
    act(() => result.current.setSelectedPayment('uba_redvault'));
    expect(result.current.selectedPayment).toBe('uba_redvault');
    expect(result.current.paymentTab).toBe('full');
  });

  it('hides stale availability immediately when the merchant changes', async () => {
    mockGetRedvaultPaymentAvailability.mockResolvedValueOnce(true);
    const { result, rerender } = renderHook(
      ({ merchantId }: { merchantId: string }) =>
        useCheckoutPaymentController({
          assuranceFee: 0,
          deliveryFee: 0,
          isAuthenticated: false,
          items,
          merchantId,
          merchantSlug: 'ogabassey',
          step: 'payment',
          subtotal: 500000,
        }),
      { initialProps: { merchantId: 'merchant-1' } }
    );
    await act(async () => undefined);
    expect(result.current.redvaultAvailable).toBe(true);
    act(() => result.current.setSelectedPayment('uba_redvault'));
    expect(result.current.availablePaymentMethods).toContain('uba_redvault');
    rerender({ merchantId: 'merchant-2' });
    expect(result.current.redvaultAvailable).toBe(false);
    expect(result.current.selectedPayment).toBeNull();
  });

  it('passes only a single nonvariant quantity-one product and hides stale results on cart changes', async () => {
    let resolveAvailability: (value: boolean) => void = () => {};
    mockGetRedvaultPaymentAvailability.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
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
    resolveAvailability(true);
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

  it('hides stale availability immediately when the authenticated customer changes', async () => {
    mockGetRedvaultPaymentAvailability.mockResolvedValueOnce(true);
    const { result, rerender } = renderHook(
      ({ customerId }: { customerId: string }) =>
        useCheckoutPaymentController({
          assuranceFee: 0,
          customerId,
          deliveryFee: 0,
          isAuthenticated: true,
          items,
          merchantId: 'merchant-1',
          merchantSlug: 'ogabassey',
          step: 'payment',
          subtotal: 500000,
        }),
      { initialProps: { customerId: 'customer-a' } }
    );
    await act(async () => undefined);
    expect(result.current.redvaultAvailable).toBe(true);

    rerender({ customerId: 'customer-b' });
    expect(result.current.redvaultAvailable).toBe(false);
    expect(mockGetRedvaultPaymentAvailability).toHaveBeenLastCalledWith(
      'merchant-1',
      'product-1'
    );
  });

  it('fails closed when availability rejects', async () => {
    mockGetRedvaultPaymentAvailability.mockRejectedValueOnce(
      new Error('offline')
    );
    const { result } = renderHook(() =>
      useCheckoutPaymentController({
        assuranceFee: 0,
        deliveryFee: 0,
        isAuthenticated: false,
        items,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        step: 'payment',
        subtotal: 500000,
      })
    );
    await act(async () => undefined);
    expect(result.current.redvaultAvailable).toBe(false);
  });

  it('clears a selected instrument when it is no longer available', () => {
    const { result, rerender } = renderHook(() =>
      useCheckoutPaymentController({
        assuranceFee: 0,
        deliveryFee: 5_000,
        isAuthenticated: false,
        items,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        step: 'payment',
        subtotal: 500_000,
      })
    );
    act(() => result.current.setSelectedPayment('paystack'));

    mockEnabledPaymentMethods = [];
    rerender({});

    expect(result.current.selectedPayment).toBeNull();
  });

  it('collapses an intent when none of its instruments remain available', () => {
    mockEnabledPaymentMethods = ['klump'];
    const { result, rerender } = renderHook(() =>
      useCheckoutPaymentController({
        assuranceFee: 0,
        deliveryFee: 5_000,
        isAuthenticated: false,
        items,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        step: 'payment',
        subtotal: 500_000,
      })
    );
    act(() => result.current.handleSelectPaymentTab('installments'));
    expect(result.current.paymentTab).toBe('installments');

    mockEnabledPaymentMethods = [];
    rerender({});

    expect(result.current.paymentTab).toBeNull();
  });
});

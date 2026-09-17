import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { CartItem } from '@/stores/cart-store';
import { useCheckoutPaymentController } from './use-checkout-payment-controller';

const mockCalculateCommerce = jest.fn();
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

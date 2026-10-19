import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import type { CartItem } from '@/stores/cart-store';
import {
  CHECKOUT_MERCHANT_ID,
  CHECKOUT_MERCHANT_SLUG,
} from './checkout-screen.constants';
import { useCheckoutScreenPayment } from './use-checkout-screen-payment';

const mockUseCheckoutPaymentController = jest.fn(
  (..._args: unknown[]) =>
    ({
      availablePaymentMethods: ['paystack'],
      displayTotal: 500000,
      orderTotals: { total: 500000 },
      paymentSettings: { taxes: [] },
      paymentTab: 'card',
      resetPaymentSelection: () => undefined,
      savings: null,
      selectedPayment: 'paystack',
      total: 500000,
      walletBalance: 0,
      walletSelection: null,
    }) as never
);

jest.mock('./use-checkout-payment-controller', () => ({
  useCheckoutPaymentController: (...args: unknown[]) =>
    mockUseCheckoutPaymentController(...args),
}));

const assuredItem: CartItem = {
  assuranceRate: 0.05,
  hasAssurance: true,
  id: 'line-1',
  name: 'Phone',
  price: 10_000,
  product_id: 'product-1',
  quantity: 2,
  slug: 'phone',
};
const plainItem: CartItem = {
  id: 'line-2',
  name: 'Case',
  price: 2_000,
  product_id: 'product-2',
  quantity: 1,
  slug: 'case',
};

const baseProps = {
  customerId: 'customer-a',
  customerPhone: '+2348000000000',
  deliveryFee: 1500,
  isAuthenticated: true,
  items: [assuredItem, plainItem],
  step: 'payment' as const,
  subtotal: 500000,
  userId: 'user-a',
};

describe('useCheckoutScreenPayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('computes the assurance fee and reshapes the controller result', () => {
    const { result } = renderHook(() =>
      useCheckoutScreenPayment({ ...baseProps, merchantId: 'merchant-1' })
    );

    // round(10_000 * 2 * 0.05); the plain item contributes nothing.
    expect(mockUseCheckoutPaymentController).toHaveBeenCalledTimes(1);
    expect(mockUseCheckoutPaymentController).toHaveBeenCalledWith({
      assuranceFee: 1000,
      customerId: 'customer-a',
      customerPhone: '+2348000000000',
      deliveryFee: 1500,
      isAuthenticated: true,
      items: [assuredItem, plainItem],
      merchantId: 'merchant-1',
      merchantSlug: CHECKOUT_MERCHANT_SLUG,
      step: 'payment',
      subtotal: 500000,
      userId: 'user-a',
    });
    expect(result.current).toEqual({
      assuranceFee: 1000,
      availablePaymentMethods: ['paystack'],
      displayTotal: 500000,
      orderTotals: { total: 500000 },
      paymentController: expect.objectContaining({
        selectedPayment: 'paystack',
      }),
      paymentSettings: { taxes: [] },
      paymentTab: 'card',
      resetPaymentSelection: expect.any(Function),
      savings: null,
      selectedPayment: 'paystack',
      total: 500000,
      walletBalance: 0,
      walletSelection: null,
    });
  });

  it.each([
    [undefined],
    [null],
  ])('falls back to the checkout merchant when merchantId is %s', (merchantId) => {
    renderHook(() => useCheckoutScreenPayment({ ...baseProps, merchantId }));

    expect(mockUseCheckoutPaymentController).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: CHECKOUT_MERCHANT_ID })
    );
  });
});

import { Alert } from 'react-native';
import { submitBnplCheckout } from './checkout-bnpl-submit';
import type { CheckoutSnapshot } from './checkout-order-builders';

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('@/services/orders', () => ({
  createOrder: jest.fn(),
  OrderError: class OrderError extends Error {},
}));

jest.mock('./checkout-screen.constants', () => ({
  CHECKOUT_API_BASE_URL: 'https://api.example.com',
  CHECKOUT_MERCHANT_DOMAIN: 'ogabassey.com',
  CHECKOUT_MERCHANT_ID: 'merchant-1',
  CHECKOUT_MERCHANT_SLUG: 'ogabassey',
}));

describe('submitBnplCheckout with PiggyVest off', () => {
  it('halts financing cleanly when net payable is zero without creating an order', async () => {
    const isOrderInFlight = { current: true };
    const setIsProcessing = jest.fn();
    const snapshot: CheckoutSnapshot = {
      assuranceFee: 0,
      deliveryFee: 0,
      subtotal: 20_000,
      taxAmount: 0,
      total: 20_000,
    };

    await submitBnplCheckout({
      address: {
        address: '12 Broad St',
        city: 'Lagos',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '08012345678',
        state: 'Lagos',
      },
      checkoutGeneration: 'gen-off-1',
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'door',
      getShippingProvider: () => undefined,
      isOrderInFlight,
      itemsSnapshot: [],
      liveSavingsSelection: undefined,
      liveWalletSelection: { use: true, amount: 20_000 },
      mobileCheckoutIdempotencyRef: { current: null },
      paymentMethodForOrder: 'klump',
      paymentSettings: {
        klump_enabled: true,
        klump_max_amount: 500_000,
        klump_min_amount: 10_000,
      },
      selectedPayment: 'klump',
      selectedQuote: undefined,
      setIsProcessing,
      snapshot,
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Financing unavailable',
      'No payable balance remains after applying store credit.',
      [{ text: 'OK' }]
    );
    expect(isOrderInFlight.current).toBe(false);
    expect(setIsProcessing).toHaveBeenCalledWith(false);
  });
});

import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { deferredBankOfferCart } from '@/lib/deferred-bank-offer-cart';
import type { OrderResponse } from '@/services/orders';
import {
  type InitializeGatewayAndRouteParams,
  initializeGatewayAndRoute,
} from './checkout-payment-initialize';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentStarted: jest.fn(),
}));
jest.mock('@/services/orders', () => ({ OrderError: Error }));
jest.mock('@/lib/deferred-bank-offer-cart', () => ({
  deferredBankOfferCart: { remember: jest.fn() },
}));

const reference = `BCO-${'a'.repeat(32)}`;
const orderResponse: OrderResponse = {
  amountDueToGateway: 5750,
  order: {
    created_at: '2026-09-20T12:00:00.000Z',
    id: 'order-1',
    order_number: 'ORD-1',
    payment_status: 'pending',
    shipping_status: 'pending',
    total: 5750,
  },
  wallet: null,
};
const params: InitializeGatewayAndRouteParams = {
  checkoutCartIdentity: 'submitted-cart',
  customerEmail: 'customer@example.test',
  customerName: 'Ada Buyer',
  customerPhone: '+2348123456789',
  orderId: 'order-1',
  orderNumber: 'ORD-1',
  orderResponse,
  selectedPayment: 'paystack',
  setIsProcessing: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      reference,
      authorization_url: 'https://pay.example/authorize',
    }),
  } as Response);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('saves the submitted bank-offer cart before opening the gateway', async () => {
  let openedWhenSaving = true;
  jest
    .mocked(deferredBankOfferCart.remember)
    .mockImplementationOnce(async () => {
      openedWhenSaving = jest.mocked(router.push).mock.calls.length > 0;
    });

  await initializeGatewayAndRoute(params);

  expect(deferredBankOfferCart.remember).toHaveBeenCalledWith(
    'order-1',
    reference,
    'submitted-cart'
  );
  expect(openedWhenSaving).toBe(false);
  expect(router.push).toHaveBeenCalledTimes(1);
});

it('does not bind a newer cart to a replayed bank-offer order', async () => {
  await initializeGatewayAndRoute({
    ...params,
    checkoutCartIdentity: 'newer-cart',
    orderResponse: { ...orderResponse, idempotency: { replayed: true } },
  });

  expect(deferredBankOfferCart.remember).not.toHaveBeenCalled();
  expect(router.push).toHaveBeenCalledTimes(1);
});

import { expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { deferredBankOfferCart } from '@/lib/deferred-bank-offer-cart';
import { settleOrderCompletion } from './payment-gateway-order-completion';
import { verifyOrderPaymentForCompletion } from './verify-order-payment';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('@/lib/deferred-bank-offer-cart', () => ({
  deferredBankOfferCart: {
    capture: jest.fn(() => 'cart-identity'),
    remember: jest.fn(async () => undefined),
  },
}));
jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentCompletedOnce: jest.fn(async () => undefined),
}));
jest.mock('./settle-redvault-funnel-completion', () => ({}));
jest.mock('./verify-order-payment', () => ({
  verifyOrderPaymentForCompletion: jest.fn(),
}));

it('leaves the gateway pending and preserves the cart while the order screen verifies a bank offer', async () => {
  jest
    .mocked(verifyOrderPaymentForCompletion)
    .mockResolvedValueOnce({ paid: false });
  const clearCart = jest.fn<() => void>();
  const setPaymentStatus = jest.fn();
  const reference = `BCO-${'a'.repeat(32)}`;
  await settleOrderCompletion(
    {
      orderId: 'order-1',
      reference,
      clearCart,
      clearPendingLoadTimeout: jest.fn(),
      isMountedRef: { current: true },
      paymentCompletionStartedRef: { current: false },
      scheduleDelayedNavigation: (navigate) => navigate(),
      setErrorMessage: jest.fn(),
      setPaymentStatus,
    },
    undefined,
    false
  );

  expect(setPaymentStatus).toHaveBeenLastCalledWith('pending');
  expect(clearCart).not.toHaveBeenCalled();
  expect(deferredBankOfferCart.remember).toHaveBeenCalledWith(
    'order-1',
    reference,
    'cart-identity'
  );
  expect(router.replace).toHaveBeenCalledWith(
    expect.objectContaining({
      pathname: '/order-success',
      params: expect.objectContaining({ reference }),
    })
  );
});

it('rejects a malformed bank offer reference before navigation or cart changes', async () => {
  jest.clearAllMocks();
  const clearCart = jest.fn<() => void>();
  const setPaymentStatus = jest.fn();
  await settleOrderCompletion(
    {
      orderId: 'order-1',
      reference: `bco-${'a'.repeat(32)}`,
      clearCart,
      clearPendingLoadTimeout: jest.fn(),
      isMountedRef: { current: true },
      paymentCompletionStartedRef: { current: false },
      scheduleDelayedNavigation: (navigate) => navigate(),
      setErrorMessage: jest.fn(),
      setPaymentStatus,
    },
    undefined,
    false
  );
  expect(clearCart).not.toHaveBeenCalled();
  expect(deferredBankOfferCart.remember).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  expect(verifyOrderPaymentForCompletion).not.toHaveBeenCalled();
  expect(setPaymentStatus).toHaveBeenLastCalledWith('error');
});

it.each([
  'cart-identity',
  null,
])('uses only a captured identity to clear a paid bank-offer cart (%s)', async (identity) => {
  jest.clearAllMocks();
  jest.mocked(deferredBankOfferCart.capture).mockReturnValueOnce(identity);
  jest
    .mocked(verifyOrderPaymentForCompletion)
    .mockResolvedValueOnce({ paid: true });
  const clearCart = jest.fn<() => void>();
  const setPaymentStatus = jest.fn();
  const reference = `BCO-${'a'.repeat(32)}`;
  await settleOrderCompletion(
    {
      orderId: 'order-1',
      reference,
      clearCart,
      clearPendingLoadTimeout: jest.fn(),
      isMountedRef: { current: true },
      paymentCompletionStartedRef: { current: false },
      scheduleDelayedNavigation: (navigate) => navigate(),
      setErrorMessage: jest.fn(),
      setPaymentStatus,
    },
    undefined,
    false
  );
  expect(setPaymentStatus).toHaveBeenLastCalledWith('success');
  expect(clearCart).not.toHaveBeenCalled();
  expect(jest.mocked(deferredBankOfferCart.remember).mock.calls).toEqual(
    identity ? [['order-1', reference, identity]] : []
  );
});

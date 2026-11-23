import { expect, it, vi } from 'vitest';
import { resolvePendingCheckoutOrder } from './pending-checkout-order';
import { recoverBankOfferCheckoutOrder } from './recover-bank-offer-checkout-order';

const snapshot = {
  orderId: 'order-1',
  trackingToken: 'track-1',
  merchantId: 'merchant-1',
  customerEmail: 'buyer@example.com',
  customerPhone: '',
  checkoutFingerprint: 'cart-1',
  paymentMethod: 'bank_card_offer',
  amountDueToGateway: 100,
  createdAt: '2026-11-20',
};

const existing = {
  id: snapshot.orderId,
  order_number: 'ORD-1',
  payment_method: 'bank_card_offer',
  payment_status: 'pending',
  shipping_status: 'pending',
  currency: 'NGN',
  total: '95.00',
};

it('reopens the saved bank offer with its authoritative rail and amount', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(existing));
  await expect(resolvePendingCheckoutOrder({
    pendingOrder: snapshot,
    merchantId: snapshot.merchantId,
    customerEmail: snapshot.customerEmail,
    checkoutFingerprint: snapshot.checkoutFingerprint,
    paymentMethod: 'bank_card_offer',
    shippingProvider: null,
    fetchImpl,
  })).resolves.toMatchObject({
    reusableOrder: {
      order: {
        id: snapshot.orderId,
        tracking_token: snapshot.trackingToken,
        payment_method: 'bank_card_offer',
      },
      amountDueToGateway: 95,
    },
    clearStoredOrder: false,
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledWith(
    '/api/storefront/orders/order-1?tracking_token=track-1'
  );
});

it('does not recover a pending offer from a mismatched order response', () => {
  expect(() => recoverBankOfferCheckoutOrder(
    { ...existing, id: 'another-order' },
    snapshot
  )).toThrow('Unable to recover the pending bank card offer order');
});

it('lets ordinary cards continue through the legacy recovery path', () => {
  expect(recoverBankOfferCheckoutOrder(
    { ...existing, payment_method: 'card' },
    snapshot
  )).toBeNull();
});

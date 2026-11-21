import { expect, it, vi } from 'vitest';
import { clearCheckoutIdempotencyKey } from './checkout-idempotency';
import { resolveBankOfferPendingCheckout } from './resolve-bank-offer-pending-checkout';

vi.mock('./checkout-idempotency', () => ({ clearCheckoutIdempotencyKey: vi.fn() }));

const pendingOrder = {
  orderId: 'order-1',
  trackingToken: 'track-1',
  merchantId: 'merchant-1',
  customerEmail: 'buyer@example.com',
  customerPhone: '',
  checkoutFingerprint: 'offer-1',
  paymentMethod: 'bank_card_offer',
  amountDueToGateway: 95,
  createdAt: '2026-11-20',
};
const options = {
  pendingOrder,
  merchantId: pendingOrder.merchantId,
  customerEmail: pendingOrder.customerEmail,
  checkoutFingerprint: pendingOrder.checkoutFingerprint,
  paymentMethod: pendingOrder.paymentMethod,
};

it.each([
  { paymentMethod: 'paystack' },
  { checkoutFingerprint: 'offer-2' },
])('keeps the existing payment fenced across changes %j', async (changes) => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      id: pendingOrder.orderId,
      shipping_status: 'processing',
      payment_status: 'pending',
    })
  );
  await expect(
    resolveBankOfferPendingCheckout({
      ...options,
      ...changes,
      fetchImpl,
    })
  ).rejects.toThrow('Check your existing order');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('returns the paid order instead of starting another payment', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      id: pendingOrder.orderId,
      order_number: 'OG-1',
      payment_status: 'paid',
    })
  );
  await expect(
    resolveBankOfferPendingCheckout({ ...options, fetchImpl })
  ).resolves.toMatchObject({
    reusableOrder: null,
    paidOrder: {
      orderId: pendingOrder.orderId,
      trackingToken: pendingOrder.trackingToken,
    },
  });
});

it.each(['pending', 'paid'])('keeps a %s saved offer fenced when the email changes', async (payment_status) => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    id: pendingOrder.orderId,
    shipping_status: 'pending',
    payment_status,
  }));
  await expect(resolveBankOfferPendingCheckout({
    ...options,
    customerEmail: 'edited@example.com',
    paymentMethod: 'paystack',
    fetchImpl,
  })).rejects.toThrow('Check your existing order');
  expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
    '/api/storefront/orders/order-1?tracking_token=track-1'
  );
});

it('rotates the saved offer key before retiring a cancelled order', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    id: pendingOrder.orderId,
    shipping_status: 'cancelled',
    payment_status: 'refunded',
  }));
  await expect(resolveBankOfferPendingCheckout({ ...options, fetchImpl })).resolves.toEqual({
    reusableOrder: null,
    clearStoredOrder: true,
  });
  expect(clearCheckoutIdempotencyKey).toHaveBeenCalledWith(pendingOrder.checkoutFingerprint);
});

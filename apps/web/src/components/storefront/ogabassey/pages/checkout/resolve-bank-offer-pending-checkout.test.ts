import { afterEach, expect, it, vi } from 'vitest';
import { clearCheckoutIdempotencyKey } from './checkout-idempotency';
import { bankOfferCheckoutReferenceStorage } from './bank-offer-checkout-reference-storage';
import { resolveBankOfferPendingCheckout } from './resolve-bank-offer-pending-checkout';

vi.mock('./checkout-idempotency', () => ({ clearCheckoutIdempotencyKey: vi.fn() }));

afterEach(() => window.sessionStorage.clear());

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

it('hands a matching saved attempt to reference verification without declaring it paid', async () => {
  const reference = `BCO-${'a'.repeat(32)}`;
  bankOfferCheckoutReferenceStorage.write(pendingOrder.merchantId, pendingOrder.orderId, reference);
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({ id: pendingOrder.orderId, payment_status: 'paid' })
  );
  await expect(
    resolveBankOfferPendingCheckout({ ...options, fetchImpl })
  ).resolves.toEqual({
    reusableOrder: null,
    clearStoredOrder: false,
    bankOfferVerification: { orderId: pendingOrder.orderId, reference },
  });
});

it('keeps a paid row without a matching reference fenced', async () => {
  bankOfferCheckoutReferenceStorage.write(pendingOrder.merchantId, 'other-order', `BCO-${'a'.repeat(32)}`);
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({ id: pendingOrder.orderId, payment_status: 'paid' })
  );
  await expect(resolveBankOfferPendingCheckout({ ...options, fetchImpl }))
    .rejects.toThrow('Check your existing order');
});

it('keeps an edited cart fenced even when the saved paid order has a reference', async () => {
  bankOfferCheckoutReferenceStorage.write(pendingOrder.merchantId, pendingOrder.orderId, `BCO-${'a'.repeat(32)}`);
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({ id: pendingOrder.orderId, payment_status: 'paid' })
  );
  await expect(resolveBankOfferPendingCheckout({
    ...options, checkoutFingerprint: 'edited', fetchImpl,
  })).rejects.toThrow('Check your existing order');
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

import { expect, it, vi } from 'vitest';
import {
  type PendingCheckoutOrderSnapshot,
  resolvePendingCheckoutOrder,
} from './pending-checkout-order';

const pending: PendingCheckoutOrderSnapshot = {
  orderId: 'order-123',
  trackingToken: 'tracking-token-123',
  merchantId: 'merchant-1',
  customerEmail: 'ada@example.test',
  customerPhone: '',
  checkoutFingerprint: 'old-fingerprint',
  amountDueToGateway: 12000,
  createdAt: '2026-11-01',
  paymentMethod: 'card',
};

it('keeps a previous gateway order when a shopper selects Oxygen with changed checkout details', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      id: pending.orderId,
      payment_status: 'unpaid',
      shipping_status: 'pending',
    })
  );
  await expect(
    resolvePendingCheckoutOrder({
      pendingOrder: pending,
      merchantId: pending.merchantId,
      customerEmail: pending.customerEmail,
      checkoutFingerprint: 'new-fingerprint',
      paymentMethod: 'oxygen',
      shippingProvider: null,
      fetchImpl,
    })
  ).rejects.toThrow('previous payment');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('routes an already paid previous order instead of creating an Oxygen order', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      id: pending.orderId,
      order_number: 'ORD-1',
      payment_status: 'paid',
      shipping_status: 'processing',
    })
  );
  const result = await resolvePendingCheckoutOrder({
    pendingOrder: pending,
    merchantId: pending.merchantId,
    customerEmail: pending.customerEmail,
    checkoutFingerprint: 'new-fingerprint',
    paymentMethod: 'oxygen',
    shippingProvider: null,
    fetchImpl,
  });
  expect(result.paidOrder?.orderId).toBe(pending.orderId);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('keeps a prior Oxygen order when switching method with changed details', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      id: pending.orderId,
      payment_status: 'unpaid',
      shipping_status: 'pending',
    })
  );
  await expect(
    resolvePendingCheckoutOrder({
      pendingOrder: { ...pending, paymentMethod: 'oxygen' },
      merchantId: pending.merchantId,
      customerEmail: pending.customerEmail,
      checkoutFingerprint: 'new-fingerprint',
      paymentMethod: 'card',
      shippingProvider: null,
      fetchImpl,
    })
  ).rejects.toThrow('previous payment');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('does not clear an unverifiable same-lane Oxygen order', async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ error: 'not found' }, { status: 404 }));
  await expect(
    resolvePendingCheckoutOrder({
      pendingOrder: { ...pending, paymentMethod: 'oxygen' },
      merchantId: pending.merchantId,
      customerEmail: pending.customerEmail,
      checkoutFingerprint: pending.checkoutFingerprint,
      paymentMethod: 'oxygen',
      shippingProvider: null,
      fetchImpl,
    })
  ).rejects.toThrow('previous payment');
});

it.each([
  'cancelled',
  'reuse_missing',
] as const)('does not replace an Oxygen order when its saved state is %s', async (state) => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
    Response.json({
      id: pending.orderId,
      payment_status: 'unpaid',
      shipping_status: state === 'cancelled' ? 'cancelled' : 'pending',
    })
  );
  if (state === 'reuse_missing')
    fetchImpl.mockResolvedValueOnce(Response.json({}, { status: 404 }));
  await expect(
    resolvePendingCheckoutOrder({
      pendingOrder: { ...pending, paymentMethod: 'oxygen' },
      merchantId: pending.merchantId,
      customerEmail: pending.customerEmail,
      checkoutFingerprint: pending.checkoutFingerprint,
      paymentMethod: 'oxygen',
      shippingProvider: null,
      fetchImpl,
    })
  ).rejects.toThrow('previous payment');
});

it.each([
  undefined,
  'tracking-token-123',
])('does not clear an unverifiable previous order (tracking token: %s)', async (trackingToken) => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ error: 'not found' }, { status: 404 }));
  await expect(
    resolvePendingCheckoutOrder({
      pendingOrder: { ...pending, trackingToken },
      merchantId: pending.merchantId,
      customerEmail: pending.customerEmail,
      checkoutFingerprint: pending.checkoutFingerprint,
      paymentMethod: 'oxygen',
      shippingProvider: null,
      fetchImpl,
    })
  ).rejects.toThrow('previous payment');
  expect(fetchImpl).toHaveBeenCalledTimes(trackingToken ? 1 : 0);
});

it('does not cancel or create an order when reusing a gateway order is fenced', async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        id: pending.orderId,
        payment_status: 'unpaid',
        shipping_status: 'pending',
      })
    )
    .mockResolvedValueOnce(
      Response.json(
        { code: 'oxygen_previous_payment_unresolved' },
        { status: 409 }
      )
    );
  // An Oxygen-origin local snapshot may be stale if the server already
  // switched the order; its 409 is preserved rather than clearing the order.
  await expect(
    resolvePendingCheckoutOrder({
      pendingOrder: { ...pending, paymentMethod: 'oxygen' },
      merchantId: pending.merchantId,
      customerEmail: pending.customerEmail,
      checkoutFingerprint: pending.checkoutFingerprint,
      paymentMethod: 'oxygen',
      shippingProvider: null,
      fetchImpl,
    })
  ).rejects.toThrow('previous payment');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

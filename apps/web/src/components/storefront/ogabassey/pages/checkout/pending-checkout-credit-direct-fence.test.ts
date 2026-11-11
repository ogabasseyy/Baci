import { expect, it, vi } from 'vitest';
import { resolvePendingCheckoutOrder } from './pending-checkout-order';

const pendingOrder = {
  orderId: 'order-1',
  trackingToken: 'tracking-1',
  merchantId: 'merchant-1',
  customerEmail: 'buyer@example.com',
  customerPhone: '',
  checkoutFingerprint: 'before-debit',
  amountDueToGateway: 30000,
  walletAmountUsed: 20000,
  paymentMethod: 'credit_direct',
  createdAt: '2026-11-07',
};
const input = {
  pendingOrder,
  merchantId: 'merchant-1',
  customerEmail: 'buyer@example.com',
  checkoutFingerprint: 'after-debit',
  paymentMethod: 'credit_direct',
  shippingProvider: null,
};

it.each([
  'credit_direct',
  'paystack',
])('does not recreate a wallet-financed order after balance refresh or switch to %s', async (paymentMethod) => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({
        id: 'order-1',
        payment_status: 'bnpl_pending',
        total: 50000,
      })
    );
  await expect(
    resolvePendingCheckoutOrder({ ...input, paymentMethod, fetchImpl })
  ).rejects.toThrow(/Credit Direct payment may still be active/);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('does not drop the pending debit when lookup loses the order', async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 404 }));
  await expect(
    resolvePendingCheckoutOrder({ ...input, fetchImpl })
  ).rejects.toThrow(/Credit Direct payment may still be active/);
});
it('routes a confirmed paid order rather than initiating financing again', async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ id: 'order-1', payment_status: 'paid', total: 50000 })
    );
  expect(
    await resolvePendingCheckoutOrder({ ...input, fetchImpl })
  ).toMatchObject({ paidOrder: { orderId: 'order-1' } });
});

it.each([false, true])('reuses the same saved order after a wallet refresh (wallet selected: %s)', async (useWalletCredit) => {
  const before = JSON.stringify({
    merchantId: 'merchant-1',
    items: [{ product_id: 'p1', price: 50000, quantity: 1 }],
    useWalletCredit: true,
    walletAmountUsed: 20000,
  });
  const after = JSON.stringify({
    merchantId: 'merchant-1',
    items: [{ product_id: 'p1', price: 50000, quantity: 1 }],
    useWalletCredit,
    walletAmountUsed: 0,
  });
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ id: 'order-1', payment_status: 'unpaid', total: 50000 })
    )
    .mockResolvedValueOnce(Response.json({ order: { id: 'order-1' } }));
  const result = await resolvePendingCheckoutOrder({
    ...input,
    pendingOrder: { ...pendingOrder, checkoutFingerprint: before },
    checkoutFingerprint: after,
    paymentMethod: 'paystack',
    fetchImpl,
  });
  expect(result).toMatchObject({
    reusableOrder: { order: { id: 'order-1' }, amountDueToGateway: 30000 },
    clearStoredOrder: false,
  });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls[1][0]).toBe('/api/orders/reuse');
});

it('consults the server reservation before switching a partially redeemed order after a wallet refresh', async () => {
  const before = JSON.stringify({ useWalletCredit: true, walletAmountUsed: 20000 });
  const after = JSON.stringify({ useWalletCredit: false, walletAmountUsed: 0 });
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id: 'order-1', payment_status: 'unpaid', total: 50000 }))
    .mockResolvedValueOnce(Response.json({ error: 'Order is no longer reusable' }, { status: 409 }));
  await expect(resolvePendingCheckoutOrder({
    ...input,
    pendingOrder: { ...pendingOrder, walletAmountUsed: 10000, checkoutFingerprint: before },
    checkoutFingerprint: after,
    paymentMethod: 'paystack',
    fetchImpl,
  })).rejects.toThrow('Failed to reopen pending checkout order');
  expect(fetchImpl.mock.calls[1]?.[0]).toBe('/api/orders/reuse');
});

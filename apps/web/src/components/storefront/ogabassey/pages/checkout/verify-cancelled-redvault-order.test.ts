import { describe, expect, it, vi } from 'vitest';
import { verifyCancelledRedvaultOrder } from './verify-cancelled-redvault-order';

const cancelledOrder = {
  id: 'order-1',
  merchant_id: 'merchant-1',
  payment_method: 'uba_redvault',
  payment_status: 'cancelled',
  shipping_status: 'cancelled',
  amount_paid: 0,
};

const proof = {
  orderId: 'order-1',
  merchantId: 'merchant-1',
  merchantSlug: 'ada-store',
  trackingToken: 'tracking-proof',
};

describe('verifyCancelledRedvaultOrder', () => {
  it('requires order, merchant, and tracking proof before making a request', async () => {
    const fetchImpl = vi.fn();
    await expect(
      verifyCancelledRedvaultOrder({ ...proof, trackingToken: '', fetchImpl })
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('confirms the exact cancelled, unpaid UBA order with a no-cache lookup', async () => {
    const fetchImpl = vi.fn(async () => Response.json(cancelledOrder));
    await expect(
      verifyCancelledRedvaultOrder({ ...proof, fetchImpl })
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/storefront/orders/order-1?tracking_token=tracking-proof&merchant_slug=ada-store',
      { cache: 'no-store' }
    );
  });

  it.each([
    { ...cancelledOrder, merchant_id: 'another-merchant' },
    { ...cancelledOrder, payment_status: 'paid' },
    { ...cancelledOrder, amount_paid: null },
    { ...cancelledOrder, amount_paid: 1 },
  ])('rejects an order that is not the unpaid cancelled review', async (order) => {
    await expect(
      verifyCancelledRedvaultOrder({
        ...proof,
        fetchImpl: async () => Response.json(order),
      })
    ).resolves.toBe(false);
  });
});

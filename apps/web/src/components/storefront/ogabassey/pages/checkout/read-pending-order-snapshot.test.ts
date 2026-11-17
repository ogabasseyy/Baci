import { beforeEach, describe, expect, it } from 'vitest';
import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from './pending-checkout-order';
import { readPendingOrderSnapshot } from './read-pending-order-snapshot';

describe('readPendingOrderSnapshot', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('returns the stored identity for the matching order, trimmed', () => {
    window.sessionStorage.setItem(
      CHECKOUT_PENDING_ORDER_STORAGE_KEY,
      JSON.stringify({
        orderId: 'order-1',
        trackingToken: 'tok',
        customerEmail: ' a@b.c ',
        customerPhone: ' 0800 ',
      })
    );

    expect(readPendingOrderSnapshot('order-1')).toEqual({
      trackingToken: 'tok',
      customerEmail: 'a@b.c',
      customerPhone: '0800',
    });
  });

  it('returns null for another order, no order id, or unreadable storage data', () => {
    window.sessionStorage.setItem(
      CHECKOUT_PENDING_ORDER_STORAGE_KEY,
      JSON.stringify({ orderId: 'order-1' })
    );
    expect(readPendingOrderSnapshot('order-2')).toBeNull();
    expect(readPendingOrderSnapshot(null)).toBeNull();

    window.sessionStorage.setItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY, '{nope');
    expect(readPendingOrderSnapshot('order-1')).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { resolveRedvaultCheckoutFence } from './pending-checkout-redvault-fence';
import type { PendingCheckoutOrderSnapshot } from './pending-checkout-order';

function snapshot(
  overrides: Partial<PendingCheckoutOrderSnapshot> = {}
): PendingCheckoutOrderSnapshot {
  return {
    orderId: 'order-1',
    merchantId: 'merchant',
    customerEmail: 'ada@example.com',
    customerPhone: '',
    checkoutFingerprint: 'fingerprint',
    amountDueToGateway: 117.5,
    createdAt: '2026-09-12',
    trackingToken: 'track-1',
    ...overrides,
  };
}

function fencedResponse(state: Record<string, unknown> | null, status = 200) {
  if (state === null) {
    return vi.fn(async () => new Response('{}', { status }));
  }
  return vi.fn(async () => Response.json(state));
}

describe('resolveRedvaultCheckoutFence', () => {
  it('returns null when neither the method nor the stored order touches REDVAULT', async () => {
    const fetchImpl = vi.fn();
    const result = await resolveRedvaultCheckoutFence({
      fetchImpl,
      paymentMethod: 'card',
      pendingOrder: snapshot({ paymentMethod: 'card' }),
    });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('enters REDVAULT with no stored order', async () => {
    const result = await resolveRedvaultCheckoutFence({
      fetchImpl: vi.fn(),
      paymentMethod: 'uba_redvault',
      pendingOrder: null,
    });
    expect(result).toEqual({ reusableOrder: null, clearStoredOrder: false });
  });

  it('validates a same-lane stored REDVAULT order instead of clearing blindly', async () => {
    const fetchImpl = fencedResponse({
      id: 'order-1',
      order_number: 'RV-1',
      payment_status: 'unpaid',
      shipping_status: 'pending',
    });
    const result = await resolveRedvaultCheckoutFence({
      fetchImpl,
      paymentMethod: 'uba_redvault',
      pendingOrder: snapshot({ paymentMethod: 'uba_redvault' }),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const firstCall = fetchImpl.mock.calls as unknown as unknown[][];
    expect(String(firstCall[0]?.[0])).toContain(
      '/api/storefront/orders/order-1'
    );
    expect(result).toEqual({
      reusableOrder: null,
      clearStoredOrder: false,
      redvaultPendingOrder: {
        orderId: 'order-1',
        orderNumber: 'RV-1',
        trackingToken: 'track-1',
        customerEmail: 'ada@example.com',
      },
    });
  });

  it('routes a same-lane REDVAULT order that got paid instead of recreating', async () => {
    const fetchImpl = fencedResponse({
      id: 'order-1',
      order_number: 'RV-1',
      payment_status: 'paid',
      shipping_status: 'processing',
    });
    const result = await resolveRedvaultCheckoutFence({
      fetchImpl,
      paymentMethod: 'uba_redvault',
      pendingOrder: snapshot({ paymentMethod: 'uba_redvault' }),
    });
    expect(result).toEqual({
      reusableOrder: null,
      clearStoredOrder: true,
      paidOrder: {
        orderId: 'order-1',
        orderNumber: 'RV-1',
        trackingToken: 'track-1',
        customerEmail: 'ada@example.com',
      },
    });
  });

  it.each([
    ['gone', null, 404],
    ['cancelled', { id: 'order-1', payment_status: 'unpaid', shipping_status: 'cancelled' }, 200],
    ['refunded while processing', { id: 'order-1', payment_status: 'refunded', shipping_status: 'processing' }, 200],
  ])('clears a same-lane REDVAULT order that is %s', async (_label, state, status) => {
    const fetchImpl = fencedResponse(
      state as Record<string, unknown> | null,
      status
    );
    const result = await resolveRedvaultCheckoutFence({
      fetchImpl,
      paymentMethod: 'uba_redvault',
      pendingOrder: snapshot({ paymentMethod: 'uba_redvault' }),
    });
    expect(result).toEqual({ reusableOrder: null, clearStoredOrder: true });
  });

  it('clears a same-lane REDVAULT snapshot it cannot validate', async () => {
    const fetchImpl = vi.fn();
    const pending = snapshot({ paymentMethod: 'uba_redvault' });
    delete pending.trackingToken;
    const result = await resolveRedvaultCheckoutFence({
      fetchImpl,
      paymentMethod: 'uba_redvault',
      pendingOrder: pending,
    });
    expect(result).toEqual({ reusableOrder: null, clearStoredOrder: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when same-lane validation errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500 }));
    await expect(
      resolveRedvaultCheckoutFence({
        fetchImpl,
        paymentMethod: 'uba_redvault',
        pendingOrder: snapshot({ paymentMethod: 'uba_redvault' }),
      })
    ).rejects.toThrow('Failed to validate pending checkout order');
  });

  it('surfaces an ordinary pending order for cancellation before REDVAULT entry', async () => {
    const fetchImpl = fencedResponse({
      id: 'order-1',
      order_number: 'ORD-1',
      payment_status: 'unpaid',
      shipping_status: 'pending',
    });
    const result = await resolveRedvaultCheckoutFence({
      fetchImpl,
      paymentMethod: 'uba_redvault',
      pendingOrder: snapshot({ paymentMethod: 'card' }),
    });
    expect(result).toEqual({
      reusableOrder: null,
      clearStoredOrder: false,
      ordinaryPendingOrder: {
        orderId: 'order-1',
        orderNumber: 'ORD-1',
        trackingToken: 'track-1',
        customerEmail: 'ada@example.com',
      },
    });
  });

  it('blocks leaving REDVAULT while the stored order is unresolved', async () => {
    const fetchImpl = fencedResponse({
      id: 'order-1',
      payment_status: 'unpaid',
      shipping_status: 'pending',
    });
    const result = await resolveRedvaultCheckoutFence({
      fetchImpl,
      paymentMethod: 'card',
      pendingOrder: snapshot({ paymentMethod: 'uba_redvault' }),
    });
    expect(result).toEqual({
      reusableOrder: null,
      clearStoredOrder: false,
      redvaultUnresolved: true,
    });
  });

  it('keeps a same-lane REDVAULT order fenced when shipping progressed without payment', async () => {
    const fetchImpl = fencedResponse({
      id: 'order-1',
      order_number: 'RV-1',
      payment_status: 'unpaid',
      shipping_status: 'processing',
    });
    const result = await resolveRedvaultCheckoutFence({
      fetchImpl,
      paymentMethod: 'uba_redvault',
      pendingOrder: snapshot({ paymentMethod: 'uba_redvault' }),
    });
    expect(result).toEqual({
      reusableOrder: null,
      clearStoredOrder: false,
      redvaultPendingOrder: {
        orderId: 'order-1',
        orderNumber: 'RV-1',
        trackingToken: 'track-1',
        customerEmail: 'ada@example.com',
      },
    });
  });

  it('keeps an ordinary order fenced when shipping progressed without payment', async () => {
    const fetchImpl = fencedResponse({
      id: 'order-1',
      order_number: 'ORD-1',
      payment_status: 'unpaid',
      shipping_status: 'shipped',
    });
    const result = await resolveRedvaultCheckoutFence({
      fetchImpl,
      paymentMethod: 'uba_redvault',
      pendingOrder: snapshot({ paymentMethod: 'card' }),
    });
    expect(result).toEqual({
      reusableOrder: null,
      clearStoredOrder: false,
      ordinaryPendingOrder: {
        orderId: 'order-1',
        orderNumber: 'ORD-1',
        trackingToken: 'track-1',
        customerEmail: 'ada@example.com',
      },
    });
  });

  it('blocks leaving REDVAULT when shipping progressed without payment', async () => {
    const fetchImpl = fencedResponse({
      id: 'order-1',
      payment_status: 'unpaid',
      shipping_status: 'processing',
    });
    const result = await resolveRedvaultCheckoutFence({
      fetchImpl,
      paymentMethod: 'card',
      pendingOrder: snapshot({ paymentMethod: 'uba_redvault' }),
    });
    expect(result).toEqual({
      reusableOrder: null,
      clearStoredOrder: false,
      redvaultUnresolved: true,
    });
  });
});

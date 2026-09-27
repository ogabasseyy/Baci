import { describe, expect, it, vi } from 'vitest';
import { cancelStaleCheckoutOrder } from './cancel-stale-checkout-order';

function responder(status: number, body: unknown = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('cancelStaleCheckoutOrder', () => {
  it('cancels through the account route when authenticated', async () => {
    const accountFetch = responder(200, { success: true, cancelled: true });
    const guestFetch = vi.fn();
    const result = await cancelStaleCheckoutOrder({
      isAuthenticated: true,
      orderId: 'order-1',
      reason: 'lane switch',
      trackingToken: 'track-1',
      accountFetch,
      guestFetch,
    });
    expect(result).toBe('cancelled');
    expect(accountFetch).toHaveBeenCalledTimes(1);
    const firstCall = accountFetch.mock.calls as unknown as unknown[][];
    expect(String(firstCall[0]?.[0])).toContain(
      '/api/storefront/account/orders/order-1/cancel'
    );
    expect(guestFetch).not.toHaveBeenCalled();
  });

  it('reports live on an authenticated 409 without falling back', async () => {
    const guestFetch = vi.fn();
    const result = await cancelStaleCheckoutOrder({
      isAuthenticated: true,
      orderId: 'order-1',
      reason: 'lane switch',
      trackingToken: 'track-1',
      accountFetch: responder(409, { code: 'order_not_cancellable' }),
      guestFetch,
    });
    expect(result).toBe('live');
    expect(guestFetch).not.toHaveBeenCalled();
  });

  it('falls back to the token route on an authenticated 404', async () => {
    const guestFetch = responder(200, { success: true, cancelled: true });
    const result = await cancelStaleCheckoutOrder({
      isAuthenticated: true,
      orderId: 'order-1',
      reason: 'lane switch',
      trackingToken: 'track-1',
      accountFetch: responder(404, { error: 'Order not found' }),
      guestFetch,
    });
    expect(result).toBe('cancelled');
    expect(guestFetch).toHaveBeenCalledTimes(1);
  });

  it('reports gone when both authenticated routes 404', async () => {
    const result = await cancelStaleCheckoutOrder({
      isAuthenticated: true,
      orderId: 'order-1',
      reason: 'lane switch',
      trackingToken: 'track-1',
      accountFetch: responder(404),
      guestFetch: responder(404),
    });
    expect(result).toBe('gone');
  });

  it('reports gone on an authenticated 404 with no token to retry', async () => {
    const guestFetch = vi.fn();
    const result = await cancelStaleCheckoutOrder({
      isAuthenticated: true,
      orderId: 'order-1',
      reason: 'lane switch',
      accountFetch: responder(404),
      guestFetch,
    });
    expect(result).toBe('gone');
    expect(guestFetch).not.toHaveBeenCalled();
  });

  it('cancels guests through the token route', async () => {
    const accountFetch = vi.fn();
    const result = await cancelStaleCheckoutOrder({
      isAuthenticated: false,
      orderId: 'order-1',
      reason: 'lane switch',
      trackingToken: 'track-1',
      accountFetch,
      guestFetch: responder(200, { success: true, cancelled: true }),
    });
    expect(result).toBe('cancelled');
    expect(accountFetch).not.toHaveBeenCalled();
  });

  it('fails closed on an unauthenticated guest 404', async () => {
    const result = await cancelStaleCheckoutOrder({
      isAuthenticated: false,
      orderId: 'order-1',
      reason: 'lane switch',
      trackingToken: 'track-1',
      accountFetch: vi.fn(),
      guestFetch: responder(404, { error: 'Order not found' }),
    });
    // The order may have been attached after signup; without a session
    // that absence is unprovable, so the lane stays blocked.
    expect(result).toBe('failed');
  });

  it('reports live on an unauthenticated guest 409', async () => {
    const result = await cancelStaleCheckoutOrder({
      isAuthenticated: false,
      orderId: 'order-1',
      reason: 'lane switch',
      trackingToken: 'track-1',
      accountFetch: vi.fn(),
      guestFetch: responder(409, { code: 'order_not_cancellable' }),
    });
    expect(result).toBe('live');
  });

  it('fails when a guest has no token to prove ownership', async () => {
    const guestFetch = vi.fn();
    const result = await cancelStaleCheckoutOrder({
      isAuthenticated: false,
      orderId: 'order-1',
      reason: 'lane switch',
      accountFetch: vi.fn(),
      guestFetch,
    });
    expect(result).toBe('failed');
    expect(guestFetch).not.toHaveBeenCalled();
  });

  it('fails when either route errors', async () => {
    const throwing = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(
      cancelStaleCheckoutOrder({
        isAuthenticated: true,
        orderId: 'order-1',
        reason: 'lane switch',
        trackingToken: 'track-1',
        accountFetch: throwing,
        guestFetch: vi.fn(),
      })
    ).resolves.toBe('failed');
    await expect(
      cancelStaleCheckoutOrder({
        isAuthenticated: false,
        orderId: 'order-1',
        reason: 'lane switch',
        trackingToken: 'track-1',
        accountFetch: vi.fn(),
        guestFetch: responder(500),
      })
    ).resolves.toBe('failed');
  });
});

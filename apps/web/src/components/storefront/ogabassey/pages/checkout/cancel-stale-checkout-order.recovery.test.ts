import { describe, expect, it, vi } from 'vitest';
import { cancelStaleCheckoutOrder } from './cancel-stale-checkout-order';

const cancelledOrder = {
  id: 'order-1',
  merchant_id: 'merchant-1',
  payment_method: 'uba_redvault',
  payment_status: 'cancelled',
  shipping_status: 'cancelled',
  amount_paid: 0,
};

describe('lost terminal-review cancellation responses', () => {
  it.each([
    false,
    true,
  ])('releases a confirmed cancelled order after a lost response (authenticated: %s)', async (isAuthenticated) => {
    const cancellation = vi
      .fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, cancelled: false }), {
          status: 200,
        })
      );
    const statusFetch = vi.fn(
      async () => new Response(JSON.stringify(cancelledOrder), { status: 200 })
    );
    const options = {
      isAuthenticated,
      orderId: 'order-1',
      reason: 'changed review',
      trackingToken: 'tracking-proof',
      requireNewCancellation: true,
      merchantId: 'merchant-1',
      merchantSlug: 'ada-store',
      accountFetch: cancellation,
      guestFetch: cancellation,
      statusFetch,
    };

    await expect(cancelStaleCheckoutOrder(options)).resolves.toBe('failed');
    expect(statusFetch).not.toHaveBeenCalled();
    await expect(cancelStaleCheckoutOrder(options)).resolves.toBe('cancelled');
    expect(statusFetch).toHaveBeenCalledOnce();
    expect(statusFetch).toHaveBeenCalledWith(
      expect.stringContaining('merchant_slug=ada-store'),
      { cache: 'no-store' }
    );
  });

  it.each([
    { ...cancelledOrder, id: 'other-order' },
    { ...cancelledOrder, merchant_id: 'other-merchant' },
    { ...cancelledOrder, payment_method: 'paystack' },
    { ...cancelledOrder, payment_status: 'paid' },
    { ...cancelledOrder, amount_paid: 100 },
    { ...cancelledOrder, amount_paid: null },
    { ...cancelledOrder, shipping_status: 'pending' },
    {},
  ])('keeps the fence when the status response is not the cancelled UBA order: %j', async (status) => {
    const result = await cancelStaleCheckoutOrder({
      isAuthenticated: false,
      orderId: 'order-1',
      reason: 'changed review',
      trackingToken: 'tracking-proof',
      requireNewCancellation: true,
      merchantId: 'merchant-1',
      merchantSlug: 'ada-store',
      guestFetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true, cancelled: false }), {
            status: 200,
          })
      ),
      statusFetch: vi.fn(
        async () => new Response(JSON.stringify(status), { status: 200 })
      ),
    });

    expect(result).toBe('failed');
  });

  it.each([
    'not-found',
    'bad-json',
    'network-error',
  ] as const)('keeps the fence when the status lookup fails: %s', async (failure) => {
    const statusFetch = vi.fn(async () => {
      if (failure === 'network-error') throw new Error('offline');
      return failure === 'not-found'
        ? new Response('{}', { status: 404 })
        : new Response('not json', { status: 200 });
    });
    const result = await cancelStaleCheckoutOrder({
      isAuthenticated: false,
      orderId: 'order-1',
      reason: 'changed review',
      trackingToken: 'tracking-proof',
      requireNewCancellation: true,
      merchantId: 'merchant-1',
      merchantSlug: 'ada-store',
      guestFetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true, cancelled: false }), {
            status: 200,
          })
      ),
      statusFetch,
    });
    expect(result).toBe('failed');
  });
});

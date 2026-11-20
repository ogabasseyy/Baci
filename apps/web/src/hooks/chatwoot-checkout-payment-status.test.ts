import { afterEach, describe, expect, it, vi } from 'vitest';
import { readChatwootCheckoutPaymentStatus } from './chatwoot-checkout-payment-status';
import { stubCheckoutFetch } from './chatwoot-checkout-test-fixtures';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('readChatwootCheckoutPaymentStatus', () => {
  const read = (
    issuedAt = Date.now(),
    trackingToken: string | null = 'track-1'
  ) =>
    readChatwootCheckoutPaymentStatus({
      requestId: 'status-1',
      orderId: 'order-1',
      trackingToken,
      merchantSlug: 'store',
      issuedAt,
    });
  const track = (order: Record<string, unknown> | null) =>
    stubCheckoutFetch({
      '/api/storefront/orders/track-order': () => ({ body: { order } }),
    });

  it('reports paid, pending and terminal states for the created order', async () => {
    track({ id: 'order-1', payment_status: 'paid' });
    expect(await read()).toEqual({ requestId: 'status-1', status: 'paid' });
    track({ id: 'order-1', payment_status: 'pending' });
    expect(await read()).toEqual({ requestId: 'status-1', status: 'pending' });
    track({ id: 'order-1', payment_status: 'failed' });
    expect(await read()).toEqual({
      requestId: 'status-1',
      status: 'unavailable',
    });
  });

  it('is unavailable for another order, a missing token or an expired window', async () => {
    track({ id: 'other', payment_status: 'paid' });
    expect(await read()).toMatchObject({ status: 'unavailable' });
    const { fetchMock } = track({ id: 'order-1', payment_status: 'paid' });
    expect(await read(Date.now(), null)).toMatchObject({
      status: 'unavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    track({ id: 'order-1', payment_status: 'pending' });
    expect(await read(Date.now() - 91 * 60 * 1000)).toMatchObject({
      status: 'unavailable',
    });
  });
});

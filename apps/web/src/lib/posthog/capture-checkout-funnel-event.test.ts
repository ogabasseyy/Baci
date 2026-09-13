import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureClientEvent = vi.fn();

vi.mock('./capture-client-event', () => ({
  captureClientEvent,
}));

async function loadCaptureOnce() {
  return await import('./capture-checkout-funnel-event');
}

describe('captureCheckoutFunnelEventOnce', () => {
  beforeEach(() => {
    vi.resetModules();
    captureClientEvent.mockReset();
    window.sessionStorage.clear();
  });

  it('deduplicates confirmation events by event and order within a session', async () => {
    const { captureCheckoutFunnelEventOnce } = await loadCaptureOnce();

    captureCheckoutFunnelEventOnce('payment_completed', 'order-1', {
      order_id: 'order-1',
    });
    captureCheckoutFunnelEventOnce('payment_completed', 'order-1', {
      order_id: 'order-1',
    });

    expect(captureClientEvent).toHaveBeenCalledTimes(1);
    expect(
      window.sessionStorage.getItem('baci:payment_completed:order-1')
    ).toBe('1');
  });

  it('does not collapse events that do not have an order identity', async () => {
    const { captureCheckoutFunnelEventOnce } = await loadCaptureOnce();

    captureCheckoutFunnelEventOnce('checkout_started', undefined, {});
    captureCheckoutFunnelEventOnce('checkout_started', undefined, {});

    expect(captureClientEvent).toHaveBeenCalledTimes(2);
  });
});

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

  it('uses in-memory deduplication when session storage is unavailable', async () => {
    const storageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'sessionStorage'
    );
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('session storage unavailable');
      },
    });

    try {
      const { captureCheckoutFunnelEventOnce } = await loadCaptureOnce();
      captureCheckoutFunnelEventOnce('order_created', 'order-1', {});
      captureCheckoutFunnelEventOnce('order_created', 'order-1', {});
    } finally {
      if (storageDescriptor) {
        Object.defineProperty(window, 'sessionStorage', storageDescriptor);
      } else {
        Reflect.deleteProperty(window, 'sessionStorage');
      }
    }

    expect(captureClientEvent).toHaveBeenCalledTimes(1);
  });
});

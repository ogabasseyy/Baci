import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureBnplPaymentCompleted } from './capture-bnpl-payment-completed';

const mocks = vi.hoisted(() => ({ captureCheckoutFunnelEventOnce: vi.fn() }));

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: (...args: unknown[]) =>
    mocks.captureCheckoutFunnelEventOnce(...args),
}));

describe('captureBnplPaymentCompleted', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete window.ReactNativeWebView;
  });

  it('emits the web completion outside a native WebView', () => {
    captureBnplPaymentCompleted({
      orderId: 'order-1',
      paymentMethod: 'klump',
      reference: 'ref-1',
    });

    expect(mocks.captureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
      'order-1',
      expect.objectContaining({
        payment_method: 'klump',
        reference: 'ref-1',
      })
    );
  });

  it('stays silent inside a native BNPL WebView', () => {
    window.ReactNativeWebView = { postMessage: vi.fn() };

    captureBnplPaymentCompleted({
      orderId: 'order-1',
      paymentMethod: 'klump',
    });

    expect(mocks.captureCheckoutFunnelEventOnce).not.toHaveBeenCalled();
  });
});

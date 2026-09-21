import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureBnplPaymentCompleted,
  captureBnplPaymentFailed,
  captureBnplPaymentStarted,
} from './bnpl-funnel-attribution';

const mocks = vi.hoisted(() => ({
  captureCheckoutFunnelEventOnce: vi.fn(),
  captureClientEvent: vi.fn(),
}));

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: (...args: unknown[]) =>
    mocks.captureCheckoutFunnelEventOnce(...args),
}));

vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: (...args: unknown[]) =>
    mocks.captureClientEvent(...args),
}));

describe('bnpl-funnel-attribution', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete window.ReactNativeWebView;
  });

  it('emits the web failure with reason and totals outside a native WebView', () => {
    captureBnplPaymentFailed({
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      paymentMethod: 'klump',
      reason: 'klump_error',
      value: 5750,
      currency: 'NGN',
    });

    expect(mocks.captureClientEvent).toHaveBeenCalledTimes(1);
    expect(mocks.captureClientEvent).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentFailed,
      expect.objectContaining({
        reason: 'klump_error',
        payment_method: 'klump',
        total: 5750,
        currency: 'NGN',
      })
    );
  });

  it('emits started and completed attributions outside a native WebView', () => {
    captureBnplPaymentStarted({
      orderId: 'order-1',
      paymentMethod: 'klump',
    });
    captureBnplPaymentCompleted({
      orderId: 'order-1',
      paymentMethod: 'klump',
      reference: 'ref-1',
    });

    expect(mocks.captureClientEvent).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentStarted,
      expect.objectContaining({ payment_method: 'klump' })
    );
    expect(mocks.captureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
      'order-1',
      expect.objectContaining({
        payment_method: 'klump',
        reference: 'ref-1',
      })
    );
  });

  it('stays silent inside a native BNPL WebView to avoid double attribution', () => {
    window.ReactNativeWebView = { postMessage: vi.fn() };

    captureBnplPaymentStarted({ orderId: 'order-1', paymentMethod: 'klump' });
    captureBnplPaymentFailed({
      orderId: 'order-1',
      paymentMethod: 'klump',
      reason: 'klump_error',
    });
    captureBnplPaymentCompleted({
      orderId: 'order-1',
      paymentMethod: 'klump',
    });

    expect(mocks.captureClientEvent).not.toHaveBeenCalled();
    expect(mocks.captureCheckoutFunnelEventOnce).not.toHaveBeenCalled();
  });
});

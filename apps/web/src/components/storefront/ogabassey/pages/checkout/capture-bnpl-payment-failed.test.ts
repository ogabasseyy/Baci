import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureBnplPaymentFailed } from './capture-bnpl-payment-failed';

const mocks = vi.hoisted(() => ({ captureClientEvent: vi.fn() }));

vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: (...args: unknown[]) =>
    mocks.captureClientEvent(...args),
}));

describe('captureBnplPaymentFailed', () => {
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
      reference: 'BAC-1',
      value: 5750,
      currency: 'NGN',
    });

    expect(mocks.captureClientEvent).toHaveBeenCalledTimes(1);
    expect(mocks.captureClientEvent).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentFailed,
      expect.objectContaining({
        reason: 'klump_error',
        reference: 'BAC-1',
        payment_method: 'klump',
        total: 5750,
        currency: 'NGN',
      })
    );
  });

  it('stays silent inside a native BNPL WebView', () => {
    window.ReactNativeWebView = { postMessage: vi.fn() };

    captureBnplPaymentFailed({
      orderId: 'order-1',
      paymentMethod: 'klump',
      reason: 'klump_error',
    });

    expect(mocks.captureClientEvent).not.toHaveBeenCalled();
  });
});

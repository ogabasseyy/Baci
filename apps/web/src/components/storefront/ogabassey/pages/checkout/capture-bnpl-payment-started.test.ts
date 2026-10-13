import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureBnplPaymentStarted } from './capture-bnpl-payment-started';

const mocks = vi.hoisted(() => ({ captureClientEvent: vi.fn() }));

vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: (...args: unknown[]) =>
    mocks.captureClientEvent(...args),
}));

describe('captureBnplPaymentStarted', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete window.ReactNativeWebView;
  });

  it('emits the web start outside a native WebView', () => {
    captureBnplPaymentStarted({
      orderId: 'order-1',
      paymentMethod: 'klump',
      reference: 'BAC-1',
    });

    expect(mocks.captureClientEvent).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentStarted,
      expect.objectContaining({ payment_method: 'klump', reference: 'BAC-1' })
    );
  });

  it('stays silent inside a native BNPL WebView', () => {
    window.ReactNativeWebView = { postMessage: vi.fn() };

    captureBnplPaymentStarted({ orderId: 'order-1', paymentMethod: 'klump' });

    expect(mocks.captureClientEvent).not.toHaveBeenCalled();
  });
});

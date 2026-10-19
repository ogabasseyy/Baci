import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureCheckoutPaymentStarted } from './capture-checkout-payment-started';

const mocks = vi.hoisted(() => ({ captureClientEvent: vi.fn() }));

vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: (...args: unknown[]) =>
    mocks.captureClientEvent(...args),
}));

describe('captureCheckoutPaymentStarted', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('stamps the web start with the initialized reference', () => {
    captureCheckoutPaymentStarted({
      currency: 'NGN',
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      paymentMethod: 'paystack',
      reference: 'ref-1',
      total: 5000,
    });

    expect(mocks.captureClientEvent).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentStarted,
      expect.objectContaining({
        channel: 'web',
        currency: 'NGN',
        order_id: 'order-1',
        order_number: 'ORD-1',
        payment_method: 'paystack',
        reference: 'ref-1',
        total: 5000,
      })
    );
  });

  it('omits the reference when the flow opens without one', () => {
    captureCheckoutPaymentStarted({
      orderId: 'order-1',
      paymentMethod: 'bank_transfer',
    });

    expect(mocks.captureClientEvent).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentStarted,
      expect.objectContaining({
        order_id: 'order-1',
        payment_method: 'bank_transfer',
      })
    );
    expect(mocks.captureClientEvent.mock.calls[0][1]).not.toHaveProperty(
      'reference'
    );
  });
});

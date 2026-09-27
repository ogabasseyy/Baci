import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureCheckoutPaymentFailed } from './capture-checkout-payment-failed';

const mocks = vi.hoisted(() => ({ captureClientEvent: vi.fn() }));

vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: (...args: unknown[]) =>
    mocks.captureClientEvent(...args),
}));

describe('captureCheckoutPaymentFailed', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('attributes the failure to the stamped attempt reference', () => {
    captureCheckoutPaymentFailed({
      currency: 'NGN',
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      paymentMethod: 'credit_direct',
      reason: 'credit_direct_error',
      reference: 'ref-1',
      total: 5000,
    });

    expect(mocks.captureClientEvent).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentFailed,
      expect.objectContaining({
        order_id: 'order-1',
        payment_method: 'credit_direct',
        reason: 'credit_direct_error',
        reference: 'ref-1',
        total: 5000,
      })
    );
  });

  it('emits without a total for pre-total checkout errors', () => {
    captureCheckoutPaymentFailed({
      orderId: 'order-1',
      paymentMethod: 'paystack',
      reason: 'checkout_error',
    });

    expect(mocks.captureClientEvent).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentFailed,
      expect.objectContaining({
        order_id: 'order-1',
        reason: 'checkout_error',
      })
    );
    expect(mocks.captureClientEvent.mock.calls[0][1]).not.toHaveProperty(
      'total'
    );
  });
});

import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureCheckoutPaymentCompleted } from './capture-checkout-payment-completed';

const mocks = vi.hoisted(() => ({ captureCheckoutFunnelEventOnce: vi.fn() }));

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: (...args: unknown[]) =>
    mocks.captureCheckoutFunnelEventOnce(...args),
}));

describe('captureCheckoutPaymentCompleted', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('claims the paid conversion once per order', () => {
    captureCheckoutPaymentCompleted({
      currency: 'NGN',
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      paymentMethod: 'wallet',
      total: 5000,
    });

    expect(mocks.captureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
      'order-1',
      expect.objectContaining({
        channel: 'web',
        order_id: 'order-1',
        payment_method: 'wallet',
        payment_status: 'paid',
        total: 5000,
      })
    );
  });

  it('carries the proving reference and item count when supplied', () => {
    captureCheckoutPaymentCompleted({
      itemCount: 2,
      orderId: 'order-1',
      paymentMethod: 'bank_transfer',
      reference: 'ref-1',
      total: 5000,
    });

    expect(mocks.captureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
      'order-1',
      expect.objectContaining({
        item_count: 2,
        payment_method: 'bank_transfer',
        reference: 'ref-1',
      })
    );
  });
});

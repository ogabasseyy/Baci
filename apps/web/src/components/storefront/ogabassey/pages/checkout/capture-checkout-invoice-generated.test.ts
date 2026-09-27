import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureCheckoutInvoiceGenerated } from './capture-checkout-invoice-generated';

const mocks = vi.hoisted(() => ({ captureCheckoutFunnelEventOnce: vi.fn() }));

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: (...args: unknown[]) =>
    mocks.captureCheckoutFunnelEventOnce(...args),
}));

describe('captureCheckoutInvoiceGenerated', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('claims the unpaid proforma generation once per order', () => {
    captureCheckoutInvoiceGenerated({
      currency: 'NGN',
      itemCount: 3,
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      total: 5000,
    });

    expect(mocks.captureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.invoiceGenerated,
      'order-1',
      expect.objectContaining({
        channel: 'web',
        item_count: 3,
        order_id: 'order-1',
        payment_intent: 'proforma_invoice',
        payment_method: 'invoice',
        payment_status: 'unpaid',
        total: 5000,
      })
    );
  });
});

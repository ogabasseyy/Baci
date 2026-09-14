import { describe, expect, it } from 'vitest';
import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
  getCheckoutPaymentIntent,
} from './checkout-funnel-analytics';

describe('checkout funnel analytics contract', () => {
  it('maps the invoice choice to the proforma-invoice intent', () => {
    expect(getCheckoutPaymentIntent('invoice')).toBe('proforma_invoice');
    expect(getCheckoutPaymentIntent('paystack')).toBe('pay_now');
    expect(getCheckoutPaymentIntent('credpal')).toBe('installments');
    expect(getCheckoutPaymentIntent('unknown_method')).toBeUndefined();
  });

  it('keeps the event names and shared properties stable across clients', () => {
    expect(CHECKOUT_FUNNEL_EVENTS).toMatchObject({
      checkoutStarted: 'checkout_started',
      orderCreated: 'order_created',
      invoiceGenerated: 'invoice_generated',
      paymentCompleted: 'payment_completed',
    });

    expect(
      buildCheckoutFunnelProperties({
        channel: 'web',
        orderId: 'order-1',
        paymentIntent: 'proforma_invoice',
        paymentMethod: 'invoice',
        paymentStatus: 'unpaid',
        source: 'web_checkout',
        total: 120_000,
      })
    ).toEqual({
      channel: 'web',
      checkout_flow: 'storefront',
      currency: 'NGN',
      event_version: 1,
      order_id: 'order-1',
      payment_intent: 'proforma_invoice',
      payment_method: 'invoice',
      payment_status: 'unpaid',
      source: 'web_checkout',
      total: 120_000,
      value: 120_000,
    });
  });

  it('preserves a non-NGN checkout currency', () => {
    expect(
      buildCheckoutFunnelProperties({
        channel: 'web',
        currency: 'KES',
        source: 'web_checkout',
        total: 42_000,
      }).currency
    ).toBe('KES');
  });
});

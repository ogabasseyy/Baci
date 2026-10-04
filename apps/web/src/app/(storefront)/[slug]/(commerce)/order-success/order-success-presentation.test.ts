import { describe, expect, it } from 'vitest';
import type { StorefrontOrderData } from './fetch-storefront-order';
import {
  buildOrderSuccessCopy,
  resolveInvoicePresentation,
  resolvePaidInvoiceDocument,
} from './order-success-presentation';

function invoiceOrder(
  overrides: Partial<StorefrontOrderData> = {}
): StorefrontOrderData {
  return {
    id: 'order-1',
    order_number: 'ORD-1',
    payment_status: 'unpaid',
    payment_method: 'invoice',
    items: [],
    subtotal: 10000,
    shipping_cost: 1500,
    total: 11500,
    ...overrides,
  };
}

describe('resolveInvoicePresentation', () => {
  it('keeps proforma presentation for an uncredited unpaid invoice', () => {
    expect(
      resolveInvoicePresentation({ order: invoiceOrder(), type: 'invoice' })
    ).toEqual({ isCancelled: false, isInvoice: true, isInvoiceMethod: true });
  });

  it.each([
    { payment_status: 'cancelled', shipping_status: 'pending' },
    { payment_status: 'canceled', shipping_status: 'pending' },
    { payment_status: 'pending', shipping_status: 'cancelled' },
    { payment_status: 'pending', shipping_status: 'canceled' },
    { payment_status: 'Cancelled', shipping_status: 'pending' },
  ])('suppresses proforma actions for cancelled orders ($payment_status/$shipping_status)', ({
    payment_status,
    shipping_status,
  }) => {
    expect(
      resolveInvoicePresentation({
        order: invoiceOrder({ payment_status, shipping_status }),
        type: 'invoice',
      })
    ).toEqual({ isCancelled: true, isInvoice: false, isInvoiceMethod: true });
  });

  it('treats a credited unpaid invoice as a commercial document', () => {
    // Wallet/savings credit accepted value while the status stays
    // unpaid: the generated artifact is commercial, so the screen must
    // not render proforma copy or a proforma download label.
    expect(
      resolveInvoicePresentation({
        order: invoiceOrder({ amount_paid: 4000 }),
        type: 'invoice',
      })
    ).toEqual({ isCancelled: false, isInvoice: false, isInvoiceMethod: true });
  });

  it('treats a credited pending invoice as a commercial document', () => {
    expect(
      resolveInvoicePresentation({
        order: invoiceOrder({ payment_status: 'pending', amount_paid: 1 }),
        type: 'invoice',
      })
    ).toEqual({ isCancelled: false, isInvoice: false, isInvoiceMethod: true });
  });

  it('keeps paid, refunded, and partially paid invoices commercial', () => {
    for (const payment_status of ['paid', 'refunded', 'partially_paid']) {
      expect(
        resolveInvoicePresentation({
          order: invoiceOrder({ payment_status }),
          type: 'invoice',
        })
      ).toEqual({
        isCancelled: false,
        isInvoice: false,
        isInvoiceMethod: true,
      });
    }
  });

  it('ignores zero or missing credit', () => {
    expect(
      resolveInvoicePresentation({
        order: invoiceOrder({ amount_paid: 0 }),
        type: 'invoice',
      })
    ).toEqual({ isCancelled: false, isInvoice: true, isInvoiceMethod: true });
  });

  it('ignores a forged type=invoice hint on a non-invoice order', () => {
    // Caller-controlled query must not override the stored method once
    // the order loads: no proforma copy, no invoice downloads.
    expect(
      resolveInvoicePresentation({
        order: invoiceOrder({
          payment_status: 'pending',
          payment_method: 'paystack',
        }),
        type: 'invoice',
      })
    ).toEqual({ isCancelled: false, isInvoice: false, isInvoiceMethod: false });
  });

  it('honors the type hint only before the order loads', () => {
    expect(
      resolveInvoicePresentation({ order: null, type: 'invoice' })
    ).toEqual({ isCancelled: false, isInvoice: true, isInvoiceMethod: true });
    expect(resolveInvoicePresentation({ order: null, type: null })).toEqual({
      isCancelled: false,
      isInvoice: false,
      isInvoiceMethod: false,
    });
  });
});

describe('buildOrderSuccessCopy', () => {
  it('renders confirmed copy for a credited invoice order', () => {
    const { isInvoice } = resolveInvoicePresentation({
      order: invoiceOrder({ amount_paid: 4000 }),
      type: 'invoice',
    });
    const copy = buildOrderSuccessCopy({
      hasRecoveryState: false,
      hasValidatedOrder: true,
      isDelivered: true,
      isInvoice,
      isPayForMeUnpaid: false,
      payerName: '',
    });

    expect(copy.heading).toBe('Order Confirmed!');
    expect(copy.heading).not.toContain('Proforma');
  });

  it('claims a sent proforma only after delivery confirmation', () => {
    const delivered = buildOrderSuccessCopy({
      hasRecoveryState: false,
      hasValidatedOrder: true,
      isDelivered: true,
      isInvoice: true,
      isPayForMeUnpaid: false,
      payerName: '',
    });

    expect(delivered.heading).toBe('Proforma Invoice Ready!');
    expect(delivered.description).toContain('sent it to your email');
  });

  it('uses pending wording for an undelivered proforma', () => {
    const pending = buildOrderSuccessCopy({
      hasRecoveryState: false,
      hasValidatedOrder: true,
      isDelivered: false,
      isInvoice: true,
      isPayForMeUnpaid: false,
      payerName: '',
    });

    expect(pending.heading).toBe('Preparing Your Proforma Invoice');
    expect(pending.description).toContain('being prepared');
    expect(pending.description).not.toContain('sent it to your email');
  });
});

describe('resolvePaidInvoiceDocument', () => {
  it('offers the commercial invoice for a paid unshipped order', () => {
    expect(
      resolvePaidInvoiceDocument({
        order: invoiceOrder({ payment_status: 'paid' }),
      })
    ).toEqual({ kind: 'invoice', label: 'Download Commercial Invoice PDF' });
  });

  it('offers the receipt for paid imported orders regardless of shipping', () => {
    expect(
      resolvePaidInvoiceDocument({
        order: invoiceOrder({
          payment_status: 'paid',
          external_source: 'bumpa',
        }),
      })
    ).toEqual({ kind: 'receipt', label: 'Download Receipt PDF' });
    expect(
      resolvePaidInvoiceDocument({
        order: invoiceOrder({
          payment_status: 'paid',
          import_job_id: 'job-1',
        }),
      })
    ).toEqual({ kind: 'receipt', label: 'Download Receipt PDF' });
  });

  it('offers the receipt once a paid order ships', () => {
    expect(
      resolvePaidInvoiceDocument({
        order: invoiceOrder({
          payment_status: 'paid',
          shipping_status: 'shipped',
        }),
      })
    ).toEqual({ kind: 'receipt', label: 'Download Receipt PDF' });
    expect(
      resolvePaidInvoiceDocument({
        order: invoiceOrder({
          payment_status: 'paid',
          shipping_status: 'Delivered',
        }),
      })
    ).toEqual({ kind: 'receipt', label: 'Download Receipt PDF' });
  });
});

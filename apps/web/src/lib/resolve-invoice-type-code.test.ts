import { describe, expect, it } from 'vitest';
import { resolveInvoiceTypeCode } from './resolve-invoice-type-code';

describe('resolveInvoiceTypeCode', () => {
  it('forces 325 for unpaid invoice-method orders holding the 380 default', () => {
    expect(
      resolveInvoiceTypeCode({
        paymentMethod: 'invoice',
        isPaid: false,
        storedTypeCode: '380',
      })
    ).toBe('325');
  });

  it('forces 325 when no code is stored for an unpaid invoice order', () => {
    expect(
      resolveInvoiceTypeCode({
        paymentMethod: 'Invoice',
        isPaid: false,
        storedTypeCode: null,
      })
    ).toBe('325');
  });

  it('restores 380 once an invoice-method order is paid', () => {
    expect(
      resolveInvoiceTypeCode({
        paymentMethod: 'invoice',
        isPaid: true,
        storedTypeCode: '380',
      })
    ).toBe('380');
  });

  it('preserves an explicit non-default code on proforma orders', () => {
    expect(
      resolveInvoiceTypeCode({
        paymentMethod: 'invoice',
        isPaid: false,
        storedTypeCode: '381',
      })
    ).toBe('381');
  });

  it('defaults non-invoice orders without a stored code to 380', () => {
    expect(
      resolveInvoiceTypeCode({
        paymentMethod: 'paystack',
        isPaid: false,
        storedTypeCode: undefined,
      })
    ).toBe('380');
  });

  it('keeps unpaid pay-for-me orders out of proforma classification', () => {
    expect(
      resolveInvoiceTypeCode({
        paymentMethod: 'payforme',
        isPaid: false,
        storedTypeCode: '380',
      })
    ).toBe('380');
  });

  it('keeps the commercial code for a refunded invoice order', () => {
    // A completed-and-refunded transaction is not a quotation: the
    // download keeps its 380 name/rendering and Peppol artifact.
    expect(
      resolveInvoiceTypeCode({
        paymentMethod: 'invoice',
        isPaid: false,
        wasPaid: true,
        storedTypeCode: '380',
      })
    ).toBe('380');
    expect(
      resolveInvoiceTypeCode({
        paymentMethod: 'invoice',
        isPaid: false,
        wasPaid: true,
        storedTypeCode: null,
      })
    ).toBe('380');
  });

  it('still forces 325 for never-paid invoice orders when wasPaid is absent', () => {
    expect(
      resolveInvoiceTypeCode({
        paymentMethod: 'invoice',
        isPaid: false,
        storedTypeCode: '380',
      })
    ).toBe('325');
  });

  it('preserves the commercial code for a partially credited invoice order', () => {
    // recordPreGatewayRedemption persists wallet/savings credit onto
    // amount_paid while leaving the status unpaid: value was accepted,
    // so the stored 380 survives and the Peppol artifact is kept.
    expect(
      resolveInvoiceTypeCode({
        paymentMethod: 'invoice',
        isPaid: false,
        wasPaid: false,
        paymentStatus: 'unpaid',
        amountPaid: 22000,
        storedTypeCode: '380',
      })
    ).toBe('380');
    expect(
      resolveInvoiceTypeCode({
        paymentMethod: 'invoice',
        isPaid: false,
        paymentStatus: 'pending',
        amountPaid: 22000,
        storedTypeCode: null,
      })
    ).toBe('380');
  });

  it('preserves the commercial code for a partially paid invoice order', () => {
    // complete_merchant_invoice_partial_payment_v1 leaves the durable
    // partially_paid status: money was accepted, so the stored 380 is a
    // completed transaction's code — not the meaningless default — and
    // the Peppol artifact must survive.
    expect(
      resolveInvoiceTypeCode({
        paymentMethod: 'invoice',
        isPaid: false,
        wasPaid: false,
        paymentStatus: 'partially_paid',
        storedTypeCode: '380',
      })
    ).toBe('380');
    expect(
      resolveInvoiceTypeCode({
        paymentMethod: 'invoice',
        isPaid: false,
        paymentStatus: 'partially_paid',
        storedTypeCode: null,
      })
    ).toBe('380');
  });
});

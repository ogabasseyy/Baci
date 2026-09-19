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
});

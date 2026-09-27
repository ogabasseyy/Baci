import { describe, expect, it } from 'vitest';
import { resolveImmediateOrderEmail } from './resolve-immediate-order-email';

describe('resolveImmediateOrderEmail', () => {
  it('classifies an unpaid invoice order as a proforma quotation', () => {
    expect(
      resolveImmediateOrderEmail({
        effectivePaymentMethod: 'invoice',
        isWalletFullyPaid: false,
        isQuizVoucherFullyPaid: false,
        orderPaymentStatus: 'unpaid',
        orderNumber: 'ORD-1',
      })
    ).toEqual({
      documentKind: 'proforma',
      isPaidForEmail: false,
      subject: 'Proforma Invoice Generated - #ORD-1',
    });
  });

  it('confirms a partially credited invoice order instead of quoting', () => {
    // Accepted value (partial status or credited balance) with an
    // unpaid balance: commercial confirmation, but the receipt stays
    // unpaid.
    expect(
      resolveImmediateOrderEmail({
        effectivePaymentMethod: 'invoice',
        isWalletFullyPaid: false,
        isQuizVoucherFullyPaid: false,
        orderPaymentStatus: 'unpaid',
        paymentStatus: 'partially_paid',
        amountPaid: 400,
        orderNumber: 'ORD-1',
      })
    ).toEqual({
      documentKind: 'confirmation',
      isPaidForEmail: false,
      subject: 'Invoice Generated - #ORD-1',
    });
  });

  it('classifies an unpaid payforme order as a payment request', () => {
    expect(
      resolveImmediateOrderEmail({
        effectivePaymentMethod: 'payforme',
        isWalletFullyPaid: false,
        isQuizVoucherFullyPaid: false,
        orderPaymentStatus: 'unpaid',
        orderNumber: 'ORD-1',
      })
    ).toEqual({
      documentKind: 'payment_request',
      isPaidForEmail: false,
      subject: 'Payment Request - #ORD-1',
    });
  });

  it('confirms a fully-funded payforme order instead of requesting payment', () => {
    expect(
      resolveImmediateOrderEmail({
        effectivePaymentMethod: 'payforme',
        isWalletFullyPaid: true,
        isQuizVoucherFullyPaid: false,
        orderPaymentStatus: 'unpaid',
        orderNumber: 'ORD-1',
      })
    ).toEqual({
      documentKind: 'confirmation',
      isPaidForEmail: true,
      subject: 'Order Confirmation - #ORD-1',
    });
  });

  it('derives paid from wallet coverage despite the pre-coverage row status', () => {
    expect(
      resolveImmediateOrderEmail({
        effectivePaymentMethod: 'invoice',
        isWalletFullyPaid: true,
        isQuizVoucherFullyPaid: false,
        orderPaymentStatus: 'unpaid',
        orderNumber: 'ORD-1',
      })
    ).toEqual({
      documentKind: 'confirmation',
      isPaidForEmail: true,
      subject: 'Invoice Generated - #ORD-1',
    });
  });

  it('derives paid from quiz-voucher coverage or the row status', () => {
    expect(
      resolveImmediateOrderEmail({
        effectivePaymentMethod: 'paystack',
        isWalletFullyPaid: false,
        isQuizVoucherFullyPaid: true,
        orderPaymentStatus: 'unpaid',
        orderNumber: 'ORD-1',
      }).isPaidForEmail
    ).toBe(true);
    expect(
      resolveImmediateOrderEmail({
        effectivePaymentMethod: 'paystack',
        isWalletFullyPaid: false,
        isQuizVoucherFullyPaid: false,
        orderPaymentStatus: 'paid',
        orderNumber: 'ORD-1',
      })
    ).toEqual({
      documentKind: 'confirmation',
      isPaidForEmail: true,
      subject: 'Order Confirmation - #ORD-1',
    });
  });

  it('falls back to the request status when the row status is empty', () => {
    expect(
      resolveImmediateOrderEmail({
        effectivePaymentMethod: 'invoice',
        isWalletFullyPaid: false,
        isQuizVoucherFullyPaid: false,
        orderPaymentStatus: '',
        requestPaymentStatus: 'paid',
        orderNumber: 'ORD-1',
      }).isPaidForEmail
    ).toBe(true);
  });
});

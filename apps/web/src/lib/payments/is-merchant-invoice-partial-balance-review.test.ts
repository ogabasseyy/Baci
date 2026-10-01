import { describe, expect, it } from 'vitest';
import { isMerchantInvoicePartialBalanceReview } from '@/lib/payments/is-merchant-invoice-partial-balance-review';

describe('isMerchantInvoicePartialBalanceReview', () => {
  it('recognizes a locked merchant-invoice balance conflict', () => {
    expect(
      isMerchantInvoicePartialBalanceReview({
        error_code: 'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED',
      })
    ).toBe(true);
  });

  it.each([
    null,
    new Error('database unavailable'),
    { error_code: 'ORDER_NOT_FOUND' },
  ])('does not classify %o as a balance review', (error) => {
    expect(isMerchantInvoicePartialBalanceReview(error)).toBe(false);
  });
});

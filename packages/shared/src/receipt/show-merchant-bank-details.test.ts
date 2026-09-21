import { describe, expect, it } from 'vitest';
import { showMerchantBankDetails } from './show-merchant-bank-details';

describe('showMerchantBankDetails', () => {
  it('shows merchant bank details for naira documents', () => {
    expect(showMerchantBankDetails('NGN')).toBe(true);
    expect(showMerchantBankDetails(' ngn ')).toBe(true);
    expect(showMerchantBankDetails(null)).toBe(true);
  });

  it('suppresses merchant bank details for foreign-currency documents', () => {
    expect(showMerchantBankDetails('USD')).toBe(false);
    expect(showMerchantBankDetails('usd')).toBe(false);
  });
});

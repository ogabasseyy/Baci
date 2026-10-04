import { describe, expect, it } from 'vitest';
import { buildImmediateInvoiceMerchant } from './build-immediate-invoice-merchant';

const merchantRow = {
  business_name: 'Ogabassey',
  email: 'merchant@example.com',
  support_email: 'support@example.com',
  bank_code: '999',
  bank_name: 'Baci Bank',
  bank_account_number: '1234567890',
  bank_account_name: 'Ogabassey Ltd',
};

describe('buildImmediateInvoiceMerchant', () => {
  it('keeps merchant bank details for naira invoices', () => {
    const merchant = buildImmediateInvoiceMerchant(merchantRow, 'NGN');

    expect(merchant.bank_account_number).toBe('1234567890');
    expect(merchant.bank_name).toBe('Baci Bank');
  });

  it('strips merchant bank details for foreign-currency invoices', () => {
    const merchant = buildImmediateInvoiceMerchant(merchantRow, 'USD');

    // The PDF fallback would otherwise print this naira account beside
    // a dollar amount under Payment Instructions.
    expect(merchant.bank_code).toBeNull();
    expect(merchant.bank_account_number).toBeNull();
    expect(merchant.bank_name).toBeNull();
    expect(merchant.bank_account_name).toBeNull();
    expect(merchant.business_name).toBe('Ogabassey');
  });
});

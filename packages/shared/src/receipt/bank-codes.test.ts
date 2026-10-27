import { describe, expect, it } from 'vitest';
import { getBankNameFromCode, resolveMerchantBankName } from './bank-codes';

describe('getBankNameFromCode', () => {
  it('returns matching bank name when code exists', () => {
    expect(getBankNameFromCode('058')).toBe('Guaranty Trust Bank');
  });

  it('returns null for missing or unknown codes', () => {
    expect(getBankNameFromCode(null)).toBeNull();
    expect(getBankNameFromCode('unknown')).toBeNull();
  });
});

describe('resolveMerchantBankName', () => {
  it('prefers a valid stored name over the code', () => {
    expect(resolveMerchantBankName('GTBank', '011')).toBe('GTBank');
    expect(resolveMerchantBankName('  Zenith  ', '058')).toBe('Zenith');
  });

  it('falls back to the code map on blank or placeholder names', () => {
    expect(resolveMerchantBankName(null, '058')).toBe('Guaranty Trust Bank');
    expect(resolveMerchantBankName('', '011')).toBe('First Bank of Nigeria');
    expect(resolveMerchantBankName('Unknown', '058')).toBe(
      'Guaranty Trust Bank'
    );
    expect(resolveMerchantBankName('UNKNOWN BANK', '033')).toBe(
      'United Bank for Africa'
    );
    expect(resolveMerchantBankName('n/a', '057')).toBe('Zenith Bank');
  });

  it('returns empty when neither name nor code resolves', () => {
    expect(resolveMerchantBankName(null, null)).toBe('');
    expect(resolveMerchantBankName('n/a', 'nope')).toBe('');
    expect(resolveMerchantBankName(undefined, undefined)).toBe('');
  });
});

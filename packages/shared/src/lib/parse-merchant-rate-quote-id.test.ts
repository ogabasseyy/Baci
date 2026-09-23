import { describe, expect, it } from 'vitest';
import { parseMerchantRateQuoteId } from './parse-merchant-rate-quote-id';

describe('parseMerchantRateQuoteId', () => {
  it('returns the bare rate id for a valid merchant quote id', () => {
    expect(
      parseMerchantRateQuoteId('mrate_123e4567-e89b-12d3-a456-426614174000')
    ).toEqual('123e4567-e89b-12d3-a456-426614174000');
  });

  it('returns undefined without the merchant prefix', () => {
    expect(
      parseMerchantRateQuoteId('123e4567-e89b-12d3-a456-426614174000')
    ).toBeUndefined();
  });

  it('returns undefined for a malformed UUID suffix', () => {
    expect(parseMerchantRateQuoteId('mrate_not-a-uuid')).toBeUndefined();
  });

  it('returns undefined for non-string input', () => {
    expect(parseMerchantRateQuoteId(undefined)).toBeUndefined();
    expect(parseMerchantRateQuoteId(null)).toBeUndefined();
    expect(parseMerchantRateQuoteId(42)).toBeUndefined();
  });
});

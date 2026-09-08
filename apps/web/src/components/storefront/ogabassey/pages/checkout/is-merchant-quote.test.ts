import { describe, expect, it } from 'vitest';
import { doorQuote, merchantShipQuote } from './delivery-quote-test-fixtures';
import { isMerchantQuote } from './is-merchant-quote';

describe('isMerchantQuote', () => {
  it('detects merchant-configured rate quotes', () => {
    expect(isMerchantQuote(merchantShipQuote)).toBe(true);
    expect(isMerchantQuote(doorQuote)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { assertQuotePriceMatchesOrderFee } from './assert-quote-price-matches-order-fee';

describe('assertQuotePriceMatchesOrderFee', () => {
  it('accepts equivalent numeric and string amounts', () => {
    expect(() =>
      assertQuotePriceMatchesOrderFee({ price: '2500.00' }, 2500)
    ).not.toThrow();
  });

  it('allows a missing persisted order fee', () => {
    expect(() =>
      assertQuotePriceMatchesOrderFee({ price: 2500 }, null)
    ).not.toThrow();
  });

  it('rejects a refreshed quote whose price differs from the paid order fee', () => {
    expect(() =>
      assertQuotePriceMatchesOrderFee({ price: 2600 }, 2500)
    ).toThrow(
      expect.objectContaining({
        code: 'QUOTE_PRICE_CHANGED',
        status: 400,
      })
    );
  });
});

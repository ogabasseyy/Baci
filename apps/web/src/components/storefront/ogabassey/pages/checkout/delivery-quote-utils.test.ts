import { describe, expect, it } from 'vitest';
import { doorQuote } from './delivery-quote-test-fixtures.test-support';
import { getDoorDeliveryQuotes, getPreferredDoorQuoteId } from './delivery-quote-utils';

describe('delivery-quote-utils barrel', () => {
  it('re-exports the split shipping quote helpers', () => {
    expect(getDoorDeliveryQuotes([doorQuote])).toEqual([doorQuote]);
    expect(getPreferredDoorQuoteId([doorQuote])).toBe('door-1');
  });
});

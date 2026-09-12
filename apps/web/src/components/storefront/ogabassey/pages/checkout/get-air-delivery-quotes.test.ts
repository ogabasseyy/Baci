import { describe, expect, it } from 'vitest';
import { doorQuote, goFasterQuote, stationQuote } from './delivery-quote-test-fixtures.test-support';
import { getAirDeliveryQuotes } from './get-air-delivery-quotes';

describe('getAirDeliveryQuotes', () => {
  it('returns GoFaster quotes only', () => {
    expect(getAirDeliveryQuotes([doorQuote, goFasterQuote, stationQuote])).toEqual([
      goFasterQuote,
    ]);
  });
});

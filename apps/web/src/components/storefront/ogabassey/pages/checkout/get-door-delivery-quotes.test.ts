import { describe, expect, it } from 'vitest';
import { doorQuote, goFasterQuote, secondStationQuote, stationGoFasterQuote, stationQuote } from './delivery-quote-test-fixtures';
import { getDoorDeliveryQuotes } from './get-door-delivery-quotes';

describe('getDoorDeliveryQuotes', () => {
  it('returns only non-station non-GoFaster quotes', () => {
    expect(
      getDoorDeliveryQuotes([
        stationQuote,
        doorQuote,
        goFasterQuote,
        secondStationQuote,
        stationGoFasterQuote,
      ]),
    ).toEqual([doorQuote]);
  });
});

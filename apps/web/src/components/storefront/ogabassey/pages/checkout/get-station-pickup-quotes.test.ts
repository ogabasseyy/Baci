import { describe, expect, it } from 'vitest';
import {
  doorQuote,
  goFasterQuote,
  secondStationQuote,
  stationGoFasterQuote,
  stationQuote,
} from './delivery-quote-test-fixtures';
import { getStationPickupQuotes } from './get-station-pickup-quotes';

describe('getStationPickupQuotes', () => {
  it('returns every station pickup quote in order', () => {
    expect(
      getStationPickupQuotes([
        stationQuote,
        doorQuote,
        goFasterQuote,
        secondStationQuote,
        stationGoFasterQuote,
      ]),
    ).toEqual([stationQuote, secondStationQuote, stationGoFasterQuote]);
  });
});

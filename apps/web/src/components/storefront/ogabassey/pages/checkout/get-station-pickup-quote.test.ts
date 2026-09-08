import { describe, expect, it } from 'vitest';
import { doorQuote, secondStationQuote, stationQuote } from './delivery-quote-test-fixtures.test-support';
import { getStationPickupQuote } from './get-station-pickup-quote';

describe('getStationPickupQuote', () => {
  it('returns the first station pickup quote', () => {
    expect(getStationPickupQuote([doorQuote, stationQuote, secondStationQuote])).toBe(
      stationQuote,
    );
  });
});

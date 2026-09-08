import { describe, expect, it } from 'vitest';
import { doorQuote, goFasterQuote, stationQuote } from './delivery-quote-test-fixtures';
import { getPreferredDoorQuoteId } from './get-preferred-door-quote-id';

describe('getPreferredDoorQuoteId', () => {
  it('returns the first door quote id', () => {
    expect(getPreferredDoorQuoteId([stationQuote, doorQuote, goFasterQuote])).toBe(
      'door-1',
    );
  });
});

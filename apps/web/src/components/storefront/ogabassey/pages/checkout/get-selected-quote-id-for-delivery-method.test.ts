import { describe, expect, it } from 'vitest';
import {
  doorQuote,
  goFasterQuote,
  secondStationQuote,
  stationGoFasterQuote,
  stationQuote,
} from './delivery-quote-test-fixtures.test-support';
import { getSelectedQuoteIdForDeliveryMethod } from './get-selected-quote-id-for-delivery-method';

describe('getSelectedQuoteIdForDeliveryMethod', () => {
  it('selects a matching quote when switching delivery methods', () => {
    const quotes = [doorQuote, goFasterQuote, stationQuote];
    expect(getSelectedQuoteIdForDeliveryMethod('pickup_station', 'door-1', quotes)).toBe(
      'station-1',
    );
    expect(getSelectedQuoteIdForDeliveryMethod('door', 'station-1', quotes)).toBe('door-1');
    expect(getSelectedQuoteIdForDeliveryMethod('airport', 'air-1', quotes)).toBe('air-1');
    expect(getSelectedQuoteIdForDeliveryMethod('airport', 'door-1', quotes)).toBe('');
    expect(
      getSelectedQuoteIdForDeliveryMethod('airport', 'station-air-1', [
        ...quotes,
        stationGoFasterQuote,
      ]),
    ).toBe('');
  });

  it('keeps a previously chosen pickup station when re-entering pickup_station', () => {
    const quotes = [doorQuote, stationQuote, secondStationQuote];
    expect(
      getSelectedQuoteIdForDeliveryMethod('pickup_station', 'station-2', quotes),
    ).toBe('station-2');
    expect(getSelectedQuoteIdForDeliveryMethod('pickup_station', 'door-1', quotes)).toBe(
      'station-1',
    );
  });

  describe('bugfix: ignore prior-method quote IDs when switching delivery modes', () => {
    it('does not carry a door quote id into pickup when no station quotes exist yet', () => {
      expect(
        getSelectedQuoteIdForDeliveryMethod('pickup_station', 'door-1', [doorQuote]),
      ).toBe('');
    });
  });
});

import { describe, expect, it } from 'vitest';
import { stationQuote } from './delivery-quote-test-fixtures';
import { getStationPickupAddressText } from './get-station-pickup-address-text';

describe('getStationPickupAddressText', () => {
  it('formats station pickup address text from available station fields', () => {
    expect(getStationPickupAddressText(stationQuote)).toBe(
      'Ikeja Service Centre, 1 Service Centre Road',
    );
    expect(
      getStationPickupAddressText({
        ...stationQuote,
        stationAddress: undefined,
      }),
    ).toBe('Ikeja Service Centre');
  });
});

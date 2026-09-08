import { describe, expect, it } from 'vitest';
import { merchantPickupQuote, stationQuote } from './delivery-quote-test-fixtures';
import { getPickupStationCopy } from './get-pickup-station-copy';

describe('getPickupStationCopy', () => {
  it('returns neutral pickup copy for merchant rates and GIGL copy otherwise', () => {
    expect(getPickupStationCopy(merchantPickupQuote).methodLabel).toBe('Store Pickup');
    expect(getPickupStationCopy(merchantPickupQuote).chooseButtonLabel).toBe(
      'Choose Store Pickup',
    );
    expect(getPickupStationCopy(stationQuote).methodLabel).toBe(
      'Pickup Stations (GIGL)',
    );
    expect(getPickupStationCopy(undefined).methodLabel).toBe(
      'Pickup Stations (GIGL)',
    );
  });
});

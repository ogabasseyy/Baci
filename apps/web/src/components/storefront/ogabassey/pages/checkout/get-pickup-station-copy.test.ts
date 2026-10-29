import { describe, expect, it } from 'vitest';
import {
  merchantPickupQuote,
  stationQuote,
} from './delivery-quote-test-fixtures.test-support';
import { getPickupStationCopy } from './get-pickup-station-copy';

describe('getPickupStationCopy', () => {
  it('does not mistake missing coverage evidence for unsupported home delivery', () => {
    expect(getPickupStationCopy(stationQuote).doorUnavailableTitle).toBe(
      'Home delivery could not be confirmed.'
    );
    expect(
      getPickupStationCopy({
        ...stationQuote,
        homeDeliveryCoverage: 'unavailable',
      }).canRetryHomeDelivery
    ).toBe(true);
  });

  it('only claims unsupported delivery after an explicit negative coverage check', () => {
    const copy = getPickupStationCopy({
      ...stationQuote,
      homeDeliveryCoverage: 'unsupported',
    });
    expect(copy.doorUnavailableTitle).toBe(
      "GIGL doesn't currently support door delivery to this location."
    );
    expect(copy.canRetryHomeDelivery).toBe(false);
  });

  it('distinguishes a rate failure from an area without coverage', () => {
    const copy = getPickupStationCopy({
      ...stationQuote,
      homeDeliveryCoverage: 'supported',
    });
    expect(copy.doorUnavailableTitle).toBe(
      'Home-delivery rates are temporarily unavailable.'
    );
    expect(copy.canRetryHomeDelivery).toBe(true);
  });

  it('returns neutral pickup copy for merchant rates and GIGL copy otherwise', () => {
    expect(getPickupStationCopy(merchantPickupQuote).methodLabel).toBe(
      'Store Pickup'
    );
    expect(getPickupStationCopy(merchantPickupQuote).chooseButtonLabel).toBe(
      'Choose Store Pickup'
    );
    expect(getPickupStationCopy(stationQuote).methodLabel).toBe(
      'Pickup Stations (GIGL)'
    );
    expect(getPickupStationCopy(undefined).methodLabel).toBe(
      'Pickup Stations (GIGL)'
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { ShippingQuote } from './types';
import { calculateDeliveryCost } from './calculate-delivery-cost';
import { isStationPickupQuote } from './is-station-pickup-quote';
import {
  createSelectDeliveryMethod,
  getAirDeliveryQuotes,
  getDeliveryEstimateLabel,
  getDoorDeliveryQuotes,
  getMerchantRateId,
  getPickupStationCopy,
  getPreferredDoorQuoteId,
  getSelectedQuoteIdForDeliveryMethod,
  getStationPickupAddressText,
  getStationPickupQuote,
  getStationPickupQuotes,
  isMerchantQuote,
  resetDeliveryQuotesForAddressChange,
} from './delivery-quote-utils';

const merchantShipQuote: ShippingQuote = {
  carrierName: 'Standard Delivery',
  currency: 'INR',
  displayName: 'Standard Delivery',
  estimatedDays: 0,
  id: 'mrate_9f1b2c3d-0000-4000-8000-000000000001',
  insuranceIncluded: false,
  pickupIncluded: false,
  price: 1500,
  provider: 'MERCHANT',
  serviceTier: 'standard',
};

const merchantPickupQuote: ShippingQuote = {
  ...merchantShipQuote,
  displayName: 'Store Pickup',
  id: 'mrate_9f1b2c3d-0000-4000-8000-000000000002',
  isStationPickup: true,
  serviceTier: 'pickup',
};

const doorQuote: ShippingQuote = {
  carrierName: 'GIG Logistics',
  currency: 'NGN',
  displayName: 'Door Delivery',
  estimatedDays: 3,
  id: 'door-1',
  insuranceIncluded: true,
  pickupIncluded: true,
  price: 3500,
  provider: 'GIGL',
  serviceTier: 'Standard',
};

const goFasterQuote: ShippingQuote = {
  ...doorQuote,
  id: 'air-1',
  serviceTier: 'GoFaster',
};

const stationGoFasterQuote: ShippingQuote = {
  ...goFasterQuote,
  id: 'station-air-1',
  isStationPickup: true,
};

const stationQuote: ShippingQuote = {
  ...doorQuote,
  displayName: 'Pickup Stations (GIGL)',
  id: 'station-1',
  isStationPickup: true,
  price: 2500,
  stationAddress: '1 Service Centre Road',
  stationName: 'Ikeja Service Centre',
};

const secondStationQuote: ShippingQuote = {
  ...stationQuote,
  id: 'station-2',
  stationAddress: '5 Allen Avenue',
  stationName: 'Allen Service Centre',
};

describe('checkout shipping quote helpers', () => {
  it('separates door and provider pickup station quotes', () => {
    const quotes = [
      stationQuote,
      doorQuote,
      goFasterQuote,
      secondStationQuote,
      stationGoFasterQuote,
    ];

    expect(isStationPickupQuote(stationQuote)).toBe(true);
    expect(getDoorDeliveryQuotes(quotes)).toEqual([doorQuote]);
    expect(getAirDeliveryQuotes(quotes)).toEqual([goFasterQuote]);
    expect(getStationPickupQuote(quotes)).toBe(stationQuote);
    expect(getStationPickupQuotes(quotes)).toEqual([
      stationQuote,
      secondStationQuote,
      stationGoFasterQuote,
    ]);
    expect(getPreferredDoorQuoteId(quotes)).toBe('door-1');
  });

  it('selects a matching quote when switching delivery methods', () => {
    const quotes = [doorQuote, goFasterQuote, stationQuote];

    expect(getSelectedQuoteIdForDeliveryMethod('pickup_station', 'door-1', quotes)).toBe(
      'station-1'
    );
    expect(getSelectedQuoteIdForDeliveryMethod('door', 'station-1', quotes)).toBe(
      'door-1'
    );
    expect(getSelectedQuoteIdForDeliveryMethod('pickup', 'station-1', quotes)).toBe(
      'station-1'
    );
    expect(
      getSelectedQuoteIdForDeliveryMethod('airport', 'air-1', quotes),
    ).toBe('air-1');
    expect(
      getSelectedQuoteIdForDeliveryMethod('airport', 'door-1', quotes),
    ).toBe('');
    expect(
      getSelectedQuoteIdForDeliveryMethod(
        'airport',
        'station-air-1',
        [...quotes, stationGoFasterQuote],
      ),
    ).toBe('');
    expect(calculateDeliveryCost('airport', 'air-1', quotes, 'delivery')).toBe(
      goFasterQuote.price,
    );
    expect(calculateDeliveryCost('airport', 'door-1', quotes, 'pickup')).toBe(
      20000,
    );
  });

  it('keeps a previously chosen pickup station when re-entering pickup_station', () => {
    const quotes = [doorQuote, stationQuote, secondStationQuote];

    expect(
      getSelectedQuoteIdForDeliveryMethod('pickup_station', 'station-2', quotes)
    ).toBe('station-2');
    expect(
      getSelectedQuoteIdForDeliveryMethod('pickup_station', 'door-1', quotes)
    ).toBe('station-1');
    expect(
      getSelectedQuoteIdForDeliveryMethod('pickup_station', '', quotes)
    ).toBe('station-1');
  });

  it('binds delivery method selection to quote and method setters', () => {
    const setDeliveryMethod = vi.fn();
    const setSelectedQuoteId = vi.fn();
    const selectDeliveryMethod = createSelectDeliveryMethod({
      selectedQuoteId: 'door-1',
      setDeliveryMethod,
      setSelectedQuoteId,
      shippingQuotes: [doorQuote, stationQuote],
    });

    selectDeliveryMethod('pickup_station');

    expect(setSelectedQuoteId).toHaveBeenCalledWith('station-1');
    expect(setDeliveryMethod).toHaveBeenCalledWith('pickup_station');
  });

  it('formats station pickup address text from available station fields', () => {
    expect(getStationPickupAddressText(stationQuote)).toBe(
      'Ikeja Service Centre, 1 Service Centre Road'
    );
    expect(
      getStationPickupAddressText({
        ...stationQuote,
        stationAddress: undefined,
      })
    ).toBe('Ikeja Service Centre');
  });

  it('clears stale delivery quotes when the address changes', () => {
    const setDeliveryMethod = vi.fn();
    const setSelectedQuoteId = vi.fn();
    const setShippingQuotes = vi.fn();

    resetDeliveryQuotesForAddressChange({
      setDeliveryMethod,
      setSelectedQuoteId,
      setShippingQuotes,
    });

    expect(setShippingQuotes).toHaveBeenCalledWith([]);
    expect(setSelectedQuoteId).toHaveBeenCalledWith('');
    expect(setDeliveryMethod).toHaveBeenCalledWith('door');
  });

  describe('bugfix: stale autocomplete coordinates after selecting a saved address', () => {
    it('clears delivery coordinates when resetting quotes for an address change', () => {
      const clearDeliveryCoordinates = vi.fn();

      resetDeliveryQuotesForAddressChange({
        setDeliveryMethod: vi.fn(),
        setSelectedQuoteId: vi.fn(),
        setShippingQuotes: vi.fn(),
        clearDeliveryCoordinates,
      });

      expect(clearDeliveryCoordinates).toHaveBeenCalledOnce();
    });
  });

  it('detects merchant-configured rate quotes', () => {
    expect(isMerchantQuote(merchantShipQuote)).toBe(true);
    expect(isMerchantQuote(doorQuote)).toBe(false);
  });

  it('recovers the bare rate id for the order POST, null for carrier quotes', () => {
    expect(getMerchantRateId(merchantShipQuote.id)).toBe(
      '9f1b2c3d-0000-4000-8000-000000000001'
    );
    expect(getMerchantRateId('door-1')).toBeNull();
    expect(getMerchantRateId('')).toBeNull();
    // A bare prefix yields null rather than an empty rate id.
    expect(getMerchantRateId('mrate_')).toBeNull();
  });

  it('omits the estimate label for the 0-day unknown sentinel', () => {
    expect(getDeliveryEstimateLabel(merchantShipQuote)).toBeNull();
    expect(getDeliveryEstimateLabel(doorQuote)).toBe('3 days');
    expect(
      getDeliveryEstimateLabel({ ...merchantShipQuote, deliveryRange: '2-4 days' })
    ).toBe('2-4 days');
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
    // No quote (default / empty state) falls back to the GIGL wording.
    expect(getPickupStationCopy(undefined).methodLabel).toBe(
      'Pickup Stations (GIGL)'
    );
  });
});

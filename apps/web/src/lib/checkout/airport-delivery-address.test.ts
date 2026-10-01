import { describe, expect, it } from 'vitest';
import { validateAirportDeliveryAddress } from './airport-delivery-address';

describe('validateAirportDeliveryAddress', () => {
  it('accepts a complete local airport delivery address', () => {
    expect(() =>
      validateAirportDeliveryAddress({
        airportType: 'delivery',
        deliveryMethod: 'airport',
        shippingAddress: {
          address: '12 Airport Road',
          city: 'Ikeja',
          state: 'Lagos',
        },
      })
    ).not.toThrow();
  });

  it('rejects a local airport delivery without address, city, or state', () => {
    expect(() =>
      validateAirportDeliveryAddress({
        airportType: 'delivery',
        deliveryMethod: 'airport',
      })
    ).toThrowError(
      expect.objectContaining({ code: 'AIRPORT_ADDRESS_REQUIRED' })
    );
  });

  it('rejects the synthetic airport destination used when no address is entered', () => {
    expect(() =>
      validateAirportDeliveryAddress({
        airportType: 'delivery',
        deliveryMethod: 'airport',
        shippingAddress: {
          address: 'Airport Delivery',
          city: 'Airport',
          state: 'Nigeria',
        },
      })
    ).toThrowError(
      expect.objectContaining({ code: 'AIRPORT_ADDRESS_REQUIRED' })
    );
  });

  it('rejects a provider-backed airport quote without a concrete street address', () => {
    expect(() =>
      validateAirportDeliveryAddress({
        airportType: 'delivery',
        deliveryMethod: 'airport',
        selectedQuoteId: 'quote-id',
        shippingAddress: {
          address: 'Airport Delivery',
          city: 'Airport',
          state: 'Nigeria',
        },
      })
    ).toThrowError(
      expect.objectContaining({ code: 'AIRPORT_ADDRESS_REQUIRED' })
    );
  });

  it('accepts fixed airport pickup with a concrete city and state', () => {
    expect(() =>
      validateAirportDeliveryAddress({
        airportType: 'pickup',
        deliveryMethod: 'airport',
        shippingAddress: {
          address: 'Airport Pickup',
          city: 'Ikeja',
          state: 'Lagos',
        },
      })
    ).not.toThrow();
  });

  it('rejects fixed airport pickup without a concrete location', () => {
    expect(() =>
      validateAirportDeliveryAddress({
        airportType: 'pickup',
        deliveryMethod: 'airport',
        shippingAddress: {
          address: 'Airport Pickup',
          city: 'Airport',
          state: 'Nigeria',
        },
      })
    ).toThrowError(
      expect.objectContaining({ code: 'AIRPORT_PICKUP_LOCATION_REQUIRED' })
    );
  });
});

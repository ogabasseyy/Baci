import { describe, expect, it } from 'vitest';
import { getLocalAirportDeliveryFee } from './airport-delivery-fee';

describe('getLocalAirportDeliveryFee', () => {
  it('returns the fixed delivery fee for a local airport order', () => {
    expect(
      getLocalAirportDeliveryFee({
        deliveryMethod: 'airport',
        airportType: 'delivery',
      })
    ).toBe(35_000);
  });

  it('returns the pickup fee for a local airport pickup', () => {
    expect(
      getLocalAirportDeliveryFee({
        deliveryMethod: 'airport',
        airportType: 'pickup',
      })
    ).toBe(20_000);
  });

  it('leaves provider-backed and merchant-rate fees to their own validators', () => {
    expect(
      getLocalAirportDeliveryFee({
        deliveryMethod: 'airport',
        selectedQuoteId: 'quote-id',
      })
    ).toBeNull();
    expect(
      getLocalAirportDeliveryFee({
        deliveryMethod: 'airport',
        shippingRateId: 'rate-id',
      })
    ).toBeNull();
  });

  it('recognizes exact legacy airport address markers', () => {
    expect(
      getLocalAirportDeliveryFee({
        shippingAddress: { address: 'Airport Delivery (Outside Lagos)' },
      })
    ).toBe(35_000);
    expect(
      getLocalAirportDeliveryFee({
        shippingAddress: { address: 'Airport Pickup' },
      })
    ).toBe(20_000);
    expect(
      getLocalAirportDeliveryFee({
        shippingAddress: { address: '123 Airport Road' },
      })
    ).toBeNull();
  });

  it('does not infer airport delivery from a fee amount on a real street address', () => {
    expect(
      getLocalAirportDeliveryFee({
        shippingAddress: { address: '12 Airport Road' },
      })
    ).toBeNull();
  });

  it('does not infer airport delivery when a client explicitly selects another method', () => {
    expect(
      getLocalAirportDeliveryFee({
        deliveryMethod: 'door',
        shippingAddress: { address: 'Airport Delivery' },
      })
    ).toBeNull();
  });
});

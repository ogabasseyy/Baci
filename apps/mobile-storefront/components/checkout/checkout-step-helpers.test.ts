import { describe, expect, it } from '@jest/globals';
import type { ShippingQuote } from '@/components/checkout/types';
import {
  findSelectedQuote,
  getDeliveryMethodFee,
  getDeliveryMethodLabel,
  getDeliveryMethodReviewDetail,
  getDeliveryMethodSummary,
  getPaymentTabForMethod,
  getQuotePreference,
  getShippingProviderForMethod,
  requiresQuote,
  resolveDoorDeliveryQuoteId,
} from './checkout-step-helpers';

const baseQuote: ShippingQuote = {
  id: 'quote-1',
  displayName: 'Topship Express',
  price: 12500,
  provider: 'Topship',
  carrierName: 'Topship Express',
  estimatedDays: 3,
};
const stationPickupQuote: ShippingQuote = {
  id: 'station-quote',
  displayName: 'GIG Logistics - Pickup at PORT HARCOURT',
  price: 9493,
  provider: 'GIGL',
  carrierName: 'GIG Logistics',
  estimatedDays: 3,
  isStationPickup: true,
  stationAddress: 'GIGL Aba Road, Port Harcourt',
  stationName: 'PORT HARCOURT',
};
const goFasterQuote: ShippingQuote = {
  ...baseQuote,
  id: 'gofaster-quote',
  provider: 'GIGL',
  serviceTier: 'GoFaster',
  price: 18500,
};
const stationGoFasterQuote: ShippingQuote = {
  ...goFasterQuote,
  id: 'station-gofaster-quote',
  isStationPickup: true,
};

describe('checkout-step-helpers', () => {
  it('maps payment methods to the right tabs', () => {
    expect(getPaymentTabForMethod('paystack')).toBe('full');
    expect(getPaymentTabForMethod('credpal')).toBe('installments');
    expect(getPaymentTabForMethod('credit_direct')).toBe('installments');
    expect(getPaymentTabForMethod('klump')).toBe('installments');
    expect(getPaymentTabForMethod('invoice')).toBe('pay_later');
    expect(getPaymentTabForMethod('payforme')).toBe('pay_later');
  });

  it('resolves delivery fees by method', () => {
    expect(getDeliveryMethodFee('airport', baseQuote)).toBe(35_000);
    expect(getDeliveryMethodFee('airport', goFasterQuote)).toBe(18500);
    expect(getDeliveryMethodFee('airport', stationGoFasterQuote)).toBe(35_000);
    expect(getDeliveryMethodFee('pickup_station', baseQuote)).toBe(0);
    expect(getDeliveryMethodFee('pickup_station', stationPickupQuote)).toBe(
      9493
    );
    expect(getDeliveryMethodFee('door', baseQuote)).toBe(12500);
    expect(getDeliveryMethodFee('door', stationPickupQuote)).toBe(0);
    expect(getDeliveryMethodFee('door', undefined)).toBe(0);
  });

  it('returns expected delivery labels', () => {
    expect(getDeliveryMethodLabel('airport')).toBe('Airport Delivery');
    expect(getDeliveryMethodLabel('pickup_station')).toBe('Pick Up Station');
    expect(getDeliveryMethodLabel('pickup_station', stationPickupQuote)).toBe(
      'Pickup Stations (GIGL)'
    );
    expect(getDeliveryMethodLabel('door')).toBe('Door Delivery');
  });

  it('returns delivery summaries by method and quote data', () => {
    expect(getDeliveryMethodSummary('airport', baseQuote)).toBe(
      'Delivery to your doorstep • Within 1–48 hours'
    );
    expect(getDeliveryMethodSummary('door', baseQuote, 'Lagos')).toBe(
      'Topship Express • Within 1–24 hours'
    );
    expect(getDeliveryMethodSummary('pickup_station', baseQuote)).toBe(
      'Merchant office pickup'
    );
    expect(getDeliveryMethodSummary('pickup_station', stationPickupQuote)).toBe(
      'PORT HARCOURT, GIGL Aba Road, Port Harcourt'
    );
    expect(getDeliveryMethodSummary('door', baseQuote)).toBe(
      'Topship Express • 3 days'
    );
    expect(
      getDeliveryMethodSummary('door', {
        ...baseQuote,
        deliveryRange: '2-4 days',
      })
    ).toBe('Topship Express • 2-4 days');
    expect(
      getDeliveryMethodSummary('door', {
        ...baseQuote,
        provider: undefined,
        carrierName: undefined,
      })
    ).toBe('Topship • 3 days');
    expect(
      getDeliveryMethodSummary('door', {
        ...baseQuote,
        estimatedDays: undefined,
        deliveryRange: undefined,
      })
    ).toBe('Topship Express • Delivery estimate shown after selection');
    expect(getDeliveryMethodSummary('door', stationPickupQuote)).toBe(
      'Topship • Delivery estimate shown after selection'
    );
    expect(getDeliveryMethodSummary('door', undefined)).toBe(
      'Topship • Delivery estimate shown after selection'
    );
  });

  it('formats delivery details for the checkout review', () => {
    expect(getDeliveryMethodReviewDetail('airport', undefined)).toBe(
      'Delivery to your doorstep • Within 1–48 hours'
    );
    expect(getDeliveryMethodReviewDetail('door', baseQuote, 'Lagos')).toBe(
      'Topship Express • Within 1–24 hours'
    );
    expect(
      getDeliveryMethodReviewDetail('door', {
        ...baseQuote,
        deliveryRange: undefined,
        estimatedDays: undefined,
      })
    ).toBe('Topship Express • Delivery estimate shown after selection');
    expect(
      getDeliveryMethodReviewDetail('pickup_station', stationPickupQuote)
    ).toBe(stationPickupQuote.displayName);
    expect(
      getDeliveryMethodReviewDetail('pickup_station', undefined)
    ).toBeUndefined();
  });

  it('returns the shipping provider for each delivery method', () => {
    expect(getShippingProviderForMethod('airport', baseQuote)).toBeUndefined();
    expect(getShippingProviderForMethod('airport', goFasterQuote)).toBe('GIGL');
    expect(
      getShippingProviderForMethod('airport', stationGoFasterQuote)
    ).toBeUndefined();
    expect(
      getShippingProviderForMethod('pickup_station', baseQuote)
    ).toBeUndefined();
    expect(
      getShippingProviderForMethod('pickup_station', stationPickupQuote)
    ).toBe('GIGL');
    expect(getShippingProviderForMethod('door', baseQuote)).toBe('Topship');
    expect(
      getShippingProviderForMethod('door', stationPickupQuote)
    ).toBeUndefined();
    expect(
      getShippingProviderForMethod('door', {
        ...baseQuote,
        provider: undefined,
        carrierName: 'Carrier fallback',
      })
    ).toBe('Carrier fallback');
    expect(
      getShippingProviderForMethod('door', {
        ...baseQuote,
        provider: undefined,
        carrierName: undefined,
      })
    ).toBeUndefined();
    expect(getShippingProviderForMethod('door', undefined)).toBeUndefined();
  });

  it('maps checkout methods to provider quote preferences', () => {
    expect(getQuotePreference('pickup_station')).toBe('pickup_station');
    expect(getQuotePreference('door')).toBe('door');
    expect(getQuotePreference('airport')).toBe('door');
  });

  it('resolves quote state requirements for local and provider air options', () => {
    expect(
      findSelectedQuote([baseQuote, goFasterQuote], 'gofaster-quote')
    ).toBe(goFasterQuote);
    expect(requiresQuote('airport', goFasterQuote, false)).toBe(true);
    expect(requiresQuote('airport', undefined, false)).toBe(false);
    expect(requiresQuote('door', undefined, false)).toBe(true);
    expect(
      requiresQuote(
        'pickup_station',
        {
          displayName: 'GIG Logistics - Pickup at IKEJA',
          id: 'station-quote',
          isStationPickup: true,
          price: 9493,
        },
        false
      )
    ).toBe(true);
  });

  it('replaces a stale air quote with the road quote when falling back to door', () => {
    // Regression: an Airport-selected GoFaster quote must not survive a
    // fallback to door — door pricing treats it as zero while the order
    // builder could still send its ID.
    expect(
      resolveDoorDeliveryQuoteId([baseQuote, goFasterQuote], 'gofaster-quote')
    ).toBe('quote-1');
    expect(
      resolveDoorDeliveryQuoteId(
        [baseQuote, stationPickupQuote],
        'station-quote'
      )
    ).toBe('quote-1');
    expect(
      resolveDoorDeliveryQuoteId([baseQuote, goFasterQuote], 'quote-1')
    ).toBe('quote-1');
    expect(resolveDoorDeliveryQuoteId([goFasterQuote], 'gofaster-quote')).toBe(
      ''
    );
    expect(resolveDoorDeliveryQuoteId([], '')).toBe('');
  });
});

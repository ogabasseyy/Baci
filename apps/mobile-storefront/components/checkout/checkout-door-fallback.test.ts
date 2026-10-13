import { describe, expect, it } from '@jest/globals';
import type { ShippingQuote } from '@/components/checkout/types';
import {
  type DeliveryFallbackInput,
  resolveDeliveryFallback,
} from './checkout-door-fallback';

const roadQuote: ShippingQuote = {
  id: 'road-1',
  displayName: 'Topship Express',
  price: 12500,
  provider: 'Topship',
};
const goFasterQuote: ShippingQuote = {
  id: 'gofaster-1',
  displayName: 'GIGL GoFaster',
  price: 18500,
  provider: 'GIGL',
  serviceTier: 'GoFaster',
};

const baseInput: DeliveryFallbackInput = {
  canUsePickupStation: true,
  deliveryMethod: 'door',
  hasResolvedDeliveryLocation: true,
  selectedQuoteId: 'road-1',
  shippingQuotes: [roadQuote, goFasterQuote],
  watchedCity: 'Ikeja',
  watchedState: 'Lagos',
};

describe('resolveDeliveryFallback', () => {
  it('keeps an eligible selection untouched', () => {
    expect(resolveDeliveryFallback(baseInput)).toEqual({
      deliveryMethod: 'door',
      selectedQuoteId: 'road-1',
    });
  });

  it('falls back to door without a resolved delivery location', () => {
    expect(
      resolveDeliveryFallback({
        ...baseInput,
        deliveryMethod: 'pickup_station',
        hasResolvedDeliveryLocation: false,
        selectedQuoteId: '',
      })
    ).toEqual({ deliveryMethod: 'door', selectedQuoteId: 'road-1' });
  });

  it('replaces a stale air quote with the road quote when airport loses eligibility', () => {
    // Same-city Lagos hides By Air even with a GoFaster quote present: the
    // fallback must not leave the air quote selected for door pricing.
    expect(
      resolveDeliveryFallback({
        ...baseInput,
        deliveryMethod: 'airport',
        selectedQuoteId: 'gofaster-1',
      })
    ).toEqual({ deliveryMethod: 'door', selectedQuoteId: 'road-1' });
  });

  it('falls back a selected airport method for Lagos-origin delivery in an airport-eligible state', () => {
    // Regression: a stale saved address with city Lagos and state Oyo is
    // store-origin delivery — an already selected By Air method must not
    // survive just because the state alone is airport-eligible.
    expect(
      resolveDeliveryFallback({
        ...baseInput,
        deliveryMethod: 'airport',
        selectedQuoteId: 'gofaster-1',
        watchedCity: 'Lagos',
        watchedState: 'Oyo',
      })
    ).toEqual({ deliveryMethod: 'door', selectedQuoteId: 'road-1' });
  });

  it('clears the selection when no road quote exists', () => {
    expect(
      resolveDeliveryFallback({
        ...baseInput,
        deliveryMethod: 'airport',
        selectedQuoteId: 'gofaster-1',
        shippingQuotes: [goFasterQuote],
      })
    ).toEqual({ deliveryMethod: 'door', selectedQuoteId: '' });
  });

  it('falls back to door when the pickup station is unavailable', () => {
    expect(
      resolveDeliveryFallback({
        ...baseInput,
        canUsePickupStation: false,
        deliveryMethod: 'pickup_station',
        selectedQuoteId: '',
      })
    ).toEqual({ deliveryMethod: 'door', selectedQuoteId: 'road-1' });
  });
});

import { describe, expect, it } from 'vitest';
import {
  isAirportDeliveryEligible,
  isPickupEligible,
  isStoreOriginDelivery,
  isWebStorefrontDeliveryMethodEligible,
  resolveEligibleWebStorefrontDeliveryMethod,
} from './delivery-method-eligibility';

describe('isStoreOriginDelivery', () => {
  it('is true for Lagos city or state (same-city as the store origin)', () => {
    expect(isStoreOriginDelivery('Ikeja', 'Lagos')).toBe(true);
    expect(isStoreOriginDelivery('Lagos', 'Lagos')).toBe(true);
    expect(isStoreOriginDelivery('  lagos ', 'Oyo')).toBe(true);
    expect(isStoreOriginDelivery('Ibadan', '  LAGOS ')).toBe(true);
  });

  it('is false for non-Lagos delivery addresses and when unset', () => {
    expect(isStoreOriginDelivery('Port Harcourt', 'Rivers')).toBe(false);
    expect(isStoreOriginDelivery('', '')).toBe(false);
    expect(isStoreOriginDelivery(undefined, undefined)).toBe(false);
    expect(isStoreOriginDelivery(null, null)).toBe(false);
  });
});

describe('isPickupEligible', () => {
  it('is true only for Lagos (case/space-insensitive)', () => {
    expect(isPickupEligible('Lagos')).toBe(true);
    expect(isPickupEligible('  lagos ')).toBe(true);
    expect(isPickupEligible('LAGOS')).toBe(true);
  });

  it('is false for other states and when no state is set', () => {
    expect(isPickupEligible('Oyo')).toBe(false);
    expect(isPickupEligible('Abuja')).toBe(false);
    expect(isPickupEligible('')).toBe(false);
    expect(isPickupEligible(undefined)).toBe(false);
    expect(isPickupEligible(null)).toBe(false);
  });
});

describe('isAirportDeliveryEligible', () => {
  it('is true for a non-Lagos state that has an airport', () => {
    expect(isAirportDeliveryEligible('Rivers')).toBe(true);
    expect(isAirportDeliveryEligible('kano')).toBe(true);
    expect(isAirportDeliveryEligible('Abuja')).toBe(true);
    expect(isAirportDeliveryEligible('FCT')).toBe(true);
    expect(isAirportDeliveryEligible('Federal Capital Territory')).toBe(true);
    expect(isAirportDeliveryEligible('FCT - Abuja')).toBe(true);
  });

  it('is false for Lagos even though the store ships from there', () => {
    expect(isAirportDeliveryEligible('Lagos')).toBe(false);
    expect(isAirportDeliveryEligible('lagos')).toBe(false);
  });

  it('is false for a state without an airport and when no state is set', () => {
    expect(isAirportDeliveryEligible('Ekiti')).toBe(false);
    expect(isAirportDeliveryEligible('Ogun')).toBe(false);
    expect(isAirportDeliveryEligible('')).toBe(false);
    expect(isAirportDeliveryEligible(undefined)).toBe(false);
    expect(isAirportDeliveryEligible(null)).toBe(false);
  });
});

describe('web storefront delivery method eligibility', () => {
  it('keeps only methods valid for the current customer state', () => {
    expect(isWebStorefrontDeliveryMethodEligible('door', '')).toBe(true);
    expect(isWebStorefrontDeliveryMethodEligible('pickup', 'Lagos')).toBe(true);
    expect(isWebStorefrontDeliveryMethodEligible('pickup', 'Abuja')).toBe(
      false
    );
    expect(isWebStorefrontDeliveryMethodEligible('airport', 'Abuja')).toBe(
      true
    );
    expect(isWebStorefrontDeliveryMethodEligible('airport', 'Lagos')).toBe(
      false
    );
    expect(
      isWebStorefrontDeliveryMethodEligible('pickup_station', 'Rivers')
    ).toBe(true);
  });

  it('falls back to door delivery when a selected method becomes ineligible', () => {
    expect(resolveEligibleWebStorefrontDeliveryMethod('pickup', 'Oyo')).toBe(
      'door'
    );
    expect(resolveEligibleWebStorefrontDeliveryMethod('airport', 'Lagos')).toBe(
      'door'
    );
    expect(resolveEligibleWebStorefrontDeliveryMethod('airport', '')).toBe(
      'door'
    );
  });

  it('preserves a selected method while it remains eligible', () => {
    expect(resolveEligibleWebStorefrontDeliveryMethod('door', 'Lagos')).toBe(
      'door'
    );
    expect(resolveEligibleWebStorefrontDeliveryMethod('pickup', 'Lagos')).toBe(
      'pickup'
    );
    expect(resolveEligibleWebStorefrontDeliveryMethod('airport', 'FCT')).toBe(
      'airport'
    );
    expect(
      resolveEligibleWebStorefrontDeliveryMethod('pickup_station', 'Oyo')
    ).toBe('pickup_station');
  });
});

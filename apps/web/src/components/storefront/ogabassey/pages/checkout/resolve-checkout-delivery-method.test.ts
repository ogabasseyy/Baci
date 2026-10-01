import { describe, expect, it } from 'vitest';
import { resolveCheckoutDeliveryMethod } from './resolve-checkout-delivery-method';

describe('resolveCheckoutDeliveryMethod', () => {
  it.each(['home-makeover', 'another-store', undefined, null])(
    'rejects a restored Ogabassey shop pickup for merchant %s',
    (slug) => {
      expect(resolveCheckoutDeliveryMethod('pickup', 'Lagos', slug)).toBe('door');
    },
  );
  it('retains Ogabassey shop pickup only in its supported state', () => {
    expect(resolveCheckoutDeliveryMethod('pickup', 'Lagos', 'ogabassey')).toBe('pickup');
    expect(resolveCheckoutDeliveryMethod('pickup', 'Oyo', 'ogabassey')).toBe('door');
  });
  it('keeps configured merchant pickup stations available for template stores', () => {
    expect(resolveCheckoutDeliveryMethod('pickup_station', 'Lagos', 'home-makeover')).toBe('pickup_station');
  });
  it('keeps the existing airport eligibility rules', () => {
    expect(resolveCheckoutDeliveryMethod('airport', 'Lagos', 'ogabassey')).toBe('door');
    expect(resolveCheckoutDeliveryMethod('airport', 'FCT', 'ogabassey')).toBe('airport');
  });
});

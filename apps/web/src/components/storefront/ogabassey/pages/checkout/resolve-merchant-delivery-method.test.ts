import { describe, expect, it } from 'vitest';
import { resolveMerchantDeliveryMethod } from './resolve-merchant-delivery-method';
describe('merchant delivery eligibility', () => {
  it.each([
    'pickup',
  ] as const)('rejects restored Ogabassey %s for Home Makeover', (method) => {
    expect(
      resolveMerchantDeliveryMethod(method, 'Lagos', 'home-makeover')
    ).toBe('door');
  });
  it('retains Ogabassey pickup in Lagos', () => {
    expect(resolveMerchantDeliveryMethod('pickup', 'Lagos', 'ogabassey')).toBe(
      'pickup'
    );
  });
  it('retains merchant configured pickup stations', () => {
    expect(
      resolveMerchantDeliveryMethod('pickup_station', 'Lagos', 'home-makeover')
    ).toBe('pickup_station');
  });
});

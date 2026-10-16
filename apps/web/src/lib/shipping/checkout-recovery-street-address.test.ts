import { describe, expect, it } from 'vitest';
import { checkoutRecoveryStreetAddress } from './checkout-recovery-street-address';

describe('confirmed recovery street address', () => {
  it.each([
    ['12 Test Street, Ikeja, Lagos', '12 Test Street'],
    ['12 Test Street, IKEJA, LAGOS', '12 Test Street'],
    ['Flat 2, 12 Test Street, Ikeja, Lagos', 'Flat 2, 12 Test Street'],
    ['12 Test Street', '12 Test Street'],
    ['12 Test Street, Abuja, FCT', '12 Test Street, Abuja, FCT'],
    [
      '12 Test Street, Ikeja, Lagos, Nigeria',
      '12 Test Street, Ikeja, Lagos, Nigeria',
    ],
  ])('preserves confirmed destination meaning for %s', (address, expected) => {
    expect(checkoutRecoveryStreetAddress(address, 'Ikeja', 'Lagos')).toBe(
      expected
    );
  });
});

import { describe, expect, it } from 'vitest';
import { checkoutRecoveryInitialStreet } from './checkout-recovery-initial-street';

describe('checkoutRecoveryInitialStreet', () => {
  it.each([
    [
      { address_line1: '12 Street', address_line2: 'Flat 4' },
      '12 Street, Flat 4',
    ],
    [
      {
        address: 'Canonical street',
        address_line1: 'Old street',
        address_line2: 'Unit 2',
      },
      'Canonical street, Unit 2',
    ],
    [
      { address: '12 Street, Flat 4', address_line2: 'Flat 4' },
      '12 Street, Flat 4',
    ],
    [
      { address: '12 Street, FLAT   4, Ikeja', address_line2: ' flat 4 ' },
      '12 Street, FLAT   4, Ikeja',
    ],
    [
      { address_line1: 'Flat 4, 12 Street', address_line2: 'Flat 4' },
      'Flat 4, 12 Street',
    ],
    [
      { address_line1: '12 Street Unit 10', address_line2: 'Unit 1' },
      '12 Street Unit 10, Unit 1',
    ],
    [{ address_line1: '4 Street', address_line2: '4' }, '4 Street, 4'],
    [{ address: '12 Street, 4', address_line2: '4' }, '12 Street, 4'],
    [
      { address: '   ', address_line1: '12 Street', address_line2: 'Unit 2' },
      '12 Street, Unit 2',
    ],
    [
      { address: 123, address_line1: '12 Street', address_line2: false },
      '12 Street',
    ],
    [{ address_line2: 'Flat 4' }, 'Flat 4'],
    [{ address: '12 Street', address_line2: '   ' }, '12 Street'],
    ['  Legacy scalar street  ', 'Legacy scalar street'],
    [null, ''],
    [undefined, ''],
    [42, ''],
    [[], ''],
    [{}, ''],
  ])('initializes %j as %j', (input, expected) => {
    expect(checkoutRecoveryInitialStreet(input)).toBe(expected);
  });
  it('does not mutate the original object or its pin provenance', () => {
    const address = Object.freeze({
      address_line1: '12 Street',
      address_line2: 'Flat 4',
      latitude: 6.5,
      longitude: 3.3,
    });
    expect(checkoutRecoveryInitialStreet(address)).toBe('12 Street, Flat 4');
    expect(address).toEqual({
      address_line1: '12 Street',
      address_line2: 'Flat 4',
      latitude: 6.5,
      longitude: 3.3,
    });
  });
});

import { describe, expect, it } from 'vitest';

import { fromOxygenMinorUnits, toOxygenMinorUnits } from './money';

describe('toOxygenMinorUnits', () => {
  it.each([
    ['integer major units', 15000, 'NGN', 1500000],
    ['fractional major units stay exact', 19.99, 'NGN', 1999],
    ['single decimal place', 15000.5, 'NGN', 1500050],
    ['string input from numeric columns', '15000.00', 'NGN', 1500000],
    ['zero amounts', 0, 'NGN', 0],
    ['lowercase currency code', 10, 'ngn', 1000],
  ])('converts %s to exact minor units', (_label, input, currency, expected) => {
    expect(toOxygenMinorUnits(input, currency)).toBe(expected);
  });

  it.each([
    ['excess precision', 19.999],
    ['excess precision in strings', '10.005'],
    ['float arithmetic artefacts', 0.1 + 0.2],
    ['negative amounts', -1],
    ['non-numeric strings', 'ten'],
    ['empty strings', ''],
    ['exponent notation', 1e21],
    ['unsafe integer magnitudes', '90071992547409.93'],
  ])('rejects %s', (_label, input) => {
    expect(() => toOxygenMinorUnits(input, 'NGN')).toThrow();
  });

  it.each([
    ['USD'],
    ['GHS'],
    [''],
    ['₦'],
  ])('rejects non-NGN currency %s', (currency) => {
    expect(() => toOxygenMinorUnits(10, currency)).toThrow();
  });
});

describe('fromOxygenMinorUnits', () => {
  it.each([
    ['integer minor units', 1500000, 'NGN', '15000.00'],
    ['fractional result', 1999, 'NGN', '19.99'],
    ['zero amounts', 0, 'NGN', '0.00'],
  ])('converts %s back to major units', (_label, input, currency, expected) => {
    expect(fromOxygenMinorUnits(input, currency)).toBe(expected);
  });

  it.each([
    [1.5],
    [-1],
    [Number.MAX_SAFE_INTEGER + 1],
  ])('rejects non-integer, negative, or unsafe minor input %s', (input) => {
    expect(() => fromOxygenMinorUnits(input, 'NGN')).toThrow();
  });

  it('rejects non-NGN currency', () => {
    expect(() => fromOxygenMinorUnits(1000, 'USD')).toThrow();
  });

  it('round-trips two-decimal major amounts without unit drift', () => {
    for (const major of ['0.00', '1.00', '19.99', '15000.50', '1000000.00']) {
      expect(
        fromOxygenMinorUnits(toOxygenMinorUnits(major, 'NGN'), 'NGN')
      ).toBe(major);
    }
  });
});

it('preserves every kobo at the safe-integer boundary without float conversion', () => {
  expect(fromOxygenMinorUnits(Number.MAX_SAFE_INTEGER, 'NGN')).toBe(
    '90071992547409.91'
  );
  expect(
    toOxygenMinorUnits(
      fromOxygenMinorUnits(Number.MAX_SAFE_INTEGER, 'NGN'),
      'NGN'
    )
  ).toBe(Number.MAX_SAFE_INTEGER);
});

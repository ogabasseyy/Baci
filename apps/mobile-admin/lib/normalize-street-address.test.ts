import { describe, expect, it } from 'vitest';
import { normalizeStreetAddressForComparison } from './normalize-street-address';

describe('normalizeStreetAddressForComparison', () => {
  it('normalizes case, trim and comma spacing', () => {
    expect(
      normalizeStreetAddressForComparison(' 42 marina ,   ikeja, lagos ')
    ).toBe('42 marina,ikeja,lagos');
    expect(normalizeStreetAddressForComparison('12 Allen,')).toBe('12 allen');
  });

  it('preserves house-number separators and non-ASCII letters', () => {
    expect(normalizeStreetAddressForComparison('12-14 Marina')).not.toBe(
      normalizeStreetAddressForComparison('1214 Marina')
    );
    expect(normalizeStreetAddressForComparison('Àlàá Street')).not.toBe(
      normalizeStreetAddressForComparison('Laa Street')
    );
  });
});

import { describe, expect, it } from 'vitest';
import { isUnsupportedSpecValue } from './is-unsupported-spec-value';

describe('isUnsupportedSpecValue', () => {
  it('rejects typed and imported placeholder values', () => {
    for (const value of [
      false,
      0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '0GB',
      'No',
      'Unknown',
      'Not known',
      'Unspecified',
      'TBD',
      'To be determined',
      'Not listed by manufacturer',
      'Not published by brand',
      'Confirm exact value from seller',
    ]) {
      expect(isUnsupportedSpecValue(value)).toBe(true);
    }
  });

  it('retains supported scalar values', () => {
    for (const value of [true, 12, 'Stereo', 'AMD Ryzen 7']) {
      expect(isUnsupportedSpecValue(value)).toBe(false);
    }
  });
  it('rejects descriptive negative capability claims', () => {
    expect(isUnsupportedSpecValue('Not supported on this model')).toBe(true);
    expect(isUnsupportedSpecValue('No OIS')).toBe(true);
  });

  it('retains identifiers beginning with the No. abbreviation', () => {
    expect(isUnsupportedSpecValue('No. 1234')).toBe(false);
  });

  it('retains descriptive values that begin with No', () => {
    expect(isUnsupportedSpecValue('No crop 4K video')).toBe(false);
  });
});

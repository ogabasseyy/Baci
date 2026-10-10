import { describe, expect, it } from 'vitest';
import { getValidConditionOptions } from './product-selection-condition';

describe('getValidConditionOptions', () => {
  it('canonicalizes aliases and drops unknown grades', () => {
    expect(
      getValidConditionOptions(['uk_used', 'refurbished', 'bogus', 'NEW'])
    ).toEqual(['used', 'open_box', 'new']);
  });
});

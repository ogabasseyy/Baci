import { describe, expect, it } from 'vitest';
import { readPackageDimensionsCm } from './package-dimensions';

describe('readPackageDimensionsCm', () => {
  it('returns centimeters for complete cm dimensions', () => {
    expect(
      readPackageDimensionsCm({ length: 10, width: 8, height: 6, unit: 'cm' })
    ).toEqual({ length: 10, width: 8, height: 6 });
  });

  it('normalizes inch dimensions to centimeters', () => {
    expect(
      readPackageDimensionsCm({ length: 4, width: 3, height: 2, unit: 'in' })
    ).toEqual({ length: 10.16, width: 7.62, height: 5.08 });
  });

  it('returns undefined when any edge is missing', () => {
    expect(
      readPackageDimensionsCm({ length: 10, width: 8, unit: 'cm' })
    ).toBeUndefined();
  });
});

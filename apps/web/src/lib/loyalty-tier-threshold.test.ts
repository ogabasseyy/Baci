import { describe, expect, it } from 'vitest';
import {
  dedupeLadderByName,
  toLadderMultiplier,
  toLadderThreshold,
} from './loyalty-tier-threshold';

describe('toLadderThreshold', () => {
  it('passes safe integers through', () => {
    expect(toLadderThreshold(100)).toBe(100);
    expect(toLadderThreshold(0)).toBe(0);
    expect(toLadderThreshold(-50)).toBe(-50);
  });

  it('coerces integer digit strings exactly like the SQL compare', () => {
    expect(toLadderThreshold('100')).toBe(100);
    expect(toLadderThreshold('-50')).toBe(-50);
    expect(toLadderThreshold('007')).toBe(7);
  });

  it('rejects numeric decimals the SQL integer-literal match rejects', () => {
    expect(toLadderThreshold(100.5)).toBeNull();
    expect(toLadderThreshold(Number.NaN)).toBeNull();
    expect(toLadderThreshold(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('rejects unsafe magnitudes that would lose precision', () => {
    expect(toLadderThreshold(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(toLadderThreshold('99999999999999999999')).toBeNull();
  });

  it('rejects null, missing, and non-numeric values as unusable', () => {
    expect(toLadderThreshold(null)).toBeNull();
    expect(toLadderThreshold(undefined)).toBeNull();
    expect(toLadderThreshold('100.5')).toBeNull();
    expect(toLadderThreshold('gold')).toBeNull();
    expect(toLadderThreshold('')).toBeNull();
    expect(toLadderThreshold({})).toBeNull();
  });

  it('coerces numeric-string multipliers like the award SQL grammar', () => {
    expect(toLadderMultiplier('2')).toBe(2);
    expect(toLadderMultiplier('1.5')).toBe(1.5);
    expect(toLadderMultiplier('-0.5')).toBe(-0.5);
    expect(toLadderMultiplier(2.5)).toBe(2.5);
  });

  it('nulls multipliers outside the award grammar', () => {
    expect(toLadderMultiplier('2x')).toBeNull();
    expect(toLadderMultiplier('')).toBeNull();
    expect(toLadderMultiplier(true)).toBeNull();
    expect(toLadderMultiplier(null)).toBeNull();
    expect(toLadderMultiplier(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('keeps the lowest rung per case-insensitive name', () => {
    expect(
      dedupeLadderByName([
        { name: 'bronze', minPoints: 0 },
        { name: 'silver', minPoints: 1000 },
        { name: 'SILVER', minPoints: 5000 },
        { name: 'gold', minPoints: 10000 },
      ])
    ).toEqual([
      { name: 'bronze', minPoints: 0 },
      { name: 'silver', minPoints: 1000 },
      { name: 'gold', minPoints: 10000 },
    ]);
  });
});

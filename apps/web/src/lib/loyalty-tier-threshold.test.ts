import { describe, expect, it } from 'vitest';
import { toLadderThreshold } from './loyalty-tier-threshold';

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

  it('floors numeric decimals the SQL integer-literal match rejects', () => {
    expect(toLadderThreshold(100.5)).toBe(0);
    expect(toLadderThreshold(Number.NaN)).toBe(0);
    expect(toLadderThreshold(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('floors unsafe magnitudes that would lose precision', () => {
    expect(toLadderThreshold(Number.MAX_SAFE_INTEGER + 1)).toBe(0);
    expect(toLadderThreshold('99999999999999999999')).toBe(0);
  });

  it('floors null, missing, and non-numeric values', () => {
    expect(toLadderThreshold(null)).toBe(0);
    expect(toLadderThreshold(undefined)).toBe(0);
    expect(toLadderThreshold('100.5')).toBe(0);
    expect(toLadderThreshold('gold')).toBe(0);
    expect(toLadderThreshold('')).toBe(0);
    expect(toLadderThreshold({})).toBe(0);
  });
});

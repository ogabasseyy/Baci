import { describe, expect, it } from 'vitest';
import { toPositiveInteger } from './transaction-review-positive-integer';

describe('toPositiveInteger', () => {
  it('normalizes positive integer values and numeric strings', () => {
    expect(toPositiveInteger(12)).toBe(12);
    expect(toPositiveInteger('12')).toBe(12);
  });

  it('rejects non-positive, fractional, and non-numeric values', () => {
    expect(toPositiveInteger(0)).toBeNull();
    expect(toPositiveInteger(-1)).toBeNull();
    expect(toPositiveInteger(1.5)).toBeNull();
    expect(toPositiveInteger('invalid')).toBeNull();
  });
});

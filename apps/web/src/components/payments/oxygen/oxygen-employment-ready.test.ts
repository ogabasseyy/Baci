import { describe, expect, it } from 'vitest';
import { isOxygenEmploymentReady } from './oxygen-employment-ready';

describe('employment readiness', () => {
  it('accepts a saved, formatted income', () => {
    expect(isOxygenEmploymentReady('250,000', '26')).toBe(true);
  });
  it.each([
    ['100', '1', true],
    ['100.25', '31', true],
    ['', '1', false],
    ['100.123', '1', false],
    ['100', '0', false],
    ['100', '32', false],
  ])('%s and %s', (amount, day, expected) => {
    expect(isOxygenEmploymentReady(amount, day)).toBe(expected);
  });
});

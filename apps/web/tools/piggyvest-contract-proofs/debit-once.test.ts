import { describe, expect, it } from 'vitest';
import { debitedOnce } from './debit-once';

describe('debitedOnce', () => {
  it('is yes for exactly the amount, and for amount plus the recorded fee', () => {
    expect(debitedOnce(1000, 1000, null)).toBe('yes');
    expect(debitedOnce(1000, 1000, 50)).toBe('yes');
    expect(debitedOnce(1000, 1050, 50)).toBe('yes');
  });
  it('is unknown, not yes, for unexplained excess when no fee was read', () => {
    expect(debitedOnce(1000, 1050, null)).toBe('unknown');
    expect(debitedOnce(1000, 1999, null)).toBe('unknown');
  });
  it('is no when the recorded fee does not account for the excess', () => {
    expect(debitedOnce(1000, 1500, 50)).toBe('no');
    expect(debitedOnce(1000, 1050, 0)).toBe('no');
  });
  it('is no for a short debit or a full extra amount', () => {
    expect(debitedOnce(1000, 999, null)).toBe('no');
    expect(debitedOnce(1000, 2000, 1000)).toBe('no');
    expect(debitedOnce(1000, 2000, null)).toBe('no');
  });
});

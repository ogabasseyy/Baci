import { describe, expect, it } from 'vitest';
import { creditedOnce, transferVerdict } from './verdict-rule';

describe('creditedOnce', () => {
  it('is yes for the gross or the gross minus the fee read', () => {
    expect(creditedOnce(100, 100, null)).toBe('yes');
    expect(creditedOnce(100, 95, 5)).toBe('yes');
  });
  it('is no for an excess or a read fee that does not explain the shortfall', () => {
    expect(creditedOnce(100, 101, 5)).toBe('no');
    expect(creditedOnce(100, 90, 5)).toBe('no');
    expect(creditedOnce(100, -5, null)).toBe('no');
  });
  it('is unknown for a shortfall with no fee read, or no credit at all', () => {
    expect(creditedOnce(100, 90, null)).toBe('unknown');
    expect(creditedOnce(100, 0, 5)).toBe('unknown');
  });
});

describe('transferVerdict', () => {
  it('is yes when both sides match, with a fee on either side', () => {
    expect(transferVerdict(1000, 1000, 1000, null).answer).toBe('yes');
    expect(transferVerdict(1000, 1100, 1000, 100).answer).toBe('yes');
    expect(transferVerdict(1000, 1000, 900, 100).answer).toBe('yes');
  });
  it('is no when a read fee does not explain a credit shortfall', () => {
    expect(transferVerdict(1000, 1000, 800, 100).answer).toBe('no');
  });
  it('is unknown, naming the side, when a shortfall has no fee', () => {
    const v = transferVerdict(1000, 1000, 900, null);
    expect(v.answer).toBe('unknown');
    expect(v.detail).toContain('credit is below the amount');
  });
  it('is no when the fee is deducted from BOTH wallets (counted once only)', () => {
    expect(transferVerdict(1000, 1100, 900, 100).answer).toBe('no');
  });
  it('is no for a double debit even when the credit is short', () => {
    expect(transferVerdict(1000, 2000, 900, null).answer).toBe('no');
  });
});

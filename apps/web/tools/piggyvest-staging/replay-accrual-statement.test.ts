import { describe, expect, it } from 'vitest';
import { PIGGYVEST_ACCRUAL_REPLAY_STATEMENT } from './replay-accrual-statement';
import { PIGGYVEST_INTEREST_REPLAY_STATEMENT } from './replay-interest-statement';

function placeholderCount(text: string): number {
  const matches = text.match(/\$\d+/g) ?? [];
  return new Set(matches).size;
}

describe('accrual replay statement', () => {
  it('binds six parameters to the accrual recorder', () => {
    expect(PIGGYVEST_ACCRUAL_REPLAY_STATEMENT.text).toContain(
      'record_interest_accrual'
    );
    expect(placeholderCount(PIGGYVEST_ACCRUAL_REPLAY_STATEMENT.text)).toBe(
      PIGGYVEST_ACCRUAL_REPLAY_STATEMENT.parameters
    );
  });
});

describe('interest replay statement', () => {
  it('binds five parameters to the interest receipt applier', () => {
    expect(PIGGYVEST_INTEREST_REPLAY_STATEMENT.text).toContain(
      'apply_interest_receipt'
    );
    expect(placeholderCount(PIGGYVEST_INTEREST_REPLAY_STATEMENT.text)).toBe(
      PIGGYVEST_INTEREST_REPLAY_STATEMENT.parameters
    );
  });
});

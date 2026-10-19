import { describe, expect, it } from 'vitest';
import { PIGGYVEST_INTEREST_REPLAY_STATEMENT } from './replay-interest-statement';

describe('PIGGYVEST_INTEREST_REPLAY_STATEMENT', () => {
  it('targets the savings ledger interest receipt applier', () => {
    expect(PIGGYVEST_INTEREST_REPLAY_STATEMENT.text).toContain(
      'piggyvest_savings_ledger.apply_interest_receipt'
    );
    expect(PIGGYVEST_INTEREST_REPLAY_STATEMENT.parameters).toBe(5);
  });
});

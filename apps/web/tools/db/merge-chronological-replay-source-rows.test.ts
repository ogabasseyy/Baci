import { describe, expect, it } from 'vitest';
import { mergeChronologicalReplaySourceRows } from './merge-chronological-replay-source-rows';

describe('mergeChronologicalReplaySourceRows', () => {
  it('sorts replay rows by migration version when blocks are appended out of order', () => {
    const merged = mergeChronologicalReplaySourceRows(
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 20260816090000_quiz_v2_prize_claim_expiry_projection.sql',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 20260812090000_add_jumia_authorizations.sql'
    );

    expect(merged).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 20260812090000_add_jumia_authorizations.sql\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 20260816090000_quiz_v2_prize_claim_expiry_projection.sql\n'
    );
  });
});

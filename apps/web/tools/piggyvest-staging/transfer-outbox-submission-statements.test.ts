import { describe, expect, it } from 'vitest';
import { PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS } from './transfer-outbox-submission-statements';

function placeholderCount(text: string): number {
  return new Set(text.match(/\$\d+/g) ?? []).size;
}

describe('PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS', () => {
  it('matches placeholder counts to declared parameters', () => {
    for (const statement of Object.values(
      PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS
    )) {
      expect(placeholderCount(statement.text)).toBe(statement.parameters);
    }
  });

  it('covers the claim lifecycle', () => {
    expect(Object.keys(PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS).sort()).toEqual([
      'claim',
      'markUnknown',
      'recordAccepted',
      'recoverUnknown',
    ]);
  });
});

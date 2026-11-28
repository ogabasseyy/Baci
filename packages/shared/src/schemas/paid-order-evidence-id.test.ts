import { describe, expect, it } from 'vitest';
import { paidOrderEvidenceIdSchema } from './paid-order-evidence-id';

describe('paidOrderEvidenceIdSchema', () => {
  it('accepts UUID evidence identifiers', () => {
    expect(
      paidOrderEvidenceIdSchema.safeParse(
        '550e8400-e29b-41d4-a716-446655440000'
      ).success
    ).toBe(true);
  });

  it('rejects malformed evidence identifiers', () => {
    expect(paidOrderEvidenceIdSchema.safeParse('not-an-id').success).toBe(
      false
    );
  });
});

import { describe, expect, it } from 'vitest';
import { opsDecisionResultSchema } from './ops-decision-result';

describe('opsDecisionResultSchema', () => {
  it('parses the decision result', () => {
    expect(
      opsDecisionResultSchema.parse({
        request_id: '3f0e0000-0000-4000-8000-000000000001',
        decision: 'approve',
        approvals: 2,
        state: 'open',
      })
    ).toEqual({
      requestId: '3f0e0000-0000-4000-8000-000000000001',
      decision: 'approve',
      approvals: 2,
      state: 'open',
    });
  });

  it('rejects an unknown state', () => {
    expect(
      opsDecisionResultSchema.safeParse({
        request_id: '3f0e0000-0000-4000-8000-000000000001',
        decision: 'approve',
        approvals: 2,
        state: 'consumed',
      }).success
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { oxygenFollowUpCandidateSchema } from './oxygen-follow-up-candidate';

const candidate = {
  order_id: '20000000-0000-4000-8000-000000000001',
  follow_up_status: 'customer_action',
  last_activity_at: '2026-11-17T09:00:00Z',
};

describe('oxygenFollowUpCandidateSchema', () => {
  it('accepts minimal, nullable, and UUID customer bindings', () => {
    expect(oxygenFollowUpCandidateSchema.parse(candidate)).toEqual(candidate);
    for (const order_customer_id of [null, candidate.order_id]) {
      expect(
        oxygenFollowUpCandidateSchema.safeParse({
          ...candidate,
          order_customer_id,
        }).success
      ).toBe(true);
    }
  });
  it.each([
    { order_id: 'bad-id' },
    { order_customer_id: 'bad-id' },
    { last_activity_at: 'yesterday' },
    { last_activity_at: null },
    { follow_up_status: 'provider message' },
    { follow_up_status: 'a'.repeat(65) },
    { provider_data: 'private' },
  ])('rejects malformed or private fields: %j', (fields) => {
    expect(
      oxygenFollowUpCandidateSchema.safeParse({ ...candidate, ...fields })
        .success
    ).toBe(false);
  });
  it('downgrades future structured categories to review', () => {
    expect(
      oxygenFollowUpCandidateSchema.parse({
        ...candidate,
        follow_up_status: 'future_status',
      }).follow_up_status
    ).toBe('needs_review');
  });
});

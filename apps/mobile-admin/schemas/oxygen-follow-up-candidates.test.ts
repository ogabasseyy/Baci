import { describe, expect, it } from 'vitest';
import { oxygenFollowUpCandidatesSchema } from './oxygen-follow-up-candidates';

const id = '20000000-0000-4000-8000-000000000001';
const candidate = {
  order_id: id,
  follow_up_status: 'customer_action',
  last_activity_at: '2026-11-17T09:00:00Z',
};

describe('oxygenFollowUpCandidatesSchema', () => {
  it('accepts only bounded, strict, dated candidate projections', () => {
    expect(
      oxygenFollowUpCandidatesSchema.safeParse(Array(250).fill(candidate))
        .success
    ).toBe(true);
    expect(
      oxygenFollowUpCandidatesSchema.safeParse(Array(251).fill(candidate))
        .success
    ).toBe(false);
    expect(
      oxygenFollowUpCandidatesSchema.safeParse([
        { ...candidate, provider_data: 'private' },
      ]).success
    ).toBe(false);
    expect(
      oxygenFollowUpCandidatesSchema.safeParse([
        { ...candidate, order_id: 'invalid' },
      ]).success
    ).toBe(false);
    expect(
      oxygenFollowUpCandidatesSchema.safeParse([
        { ...candidate, last_activity_at: 'yesterday' },
      ]).success
    ).toBe(false);
  });

  it('treats unknown structured categories as review without accepting raw messages', () => {
    for (const status of [
      'customer_action',
      'oxygen_processing',
      'approved_pending',
      'needs_review',
    ]) {
      expect(
        oxygenFollowUpCandidatesSchema.parse([
          { ...candidate, follow_up_status: status },
        ])[0].follow_up_status
      ).toBe(status);
    }
    expect(
      oxygenFollowUpCandidatesSchema.parse([
        { ...candidate, follow_up_status: 'future_status' },
      ])[0].follow_up_status
    ).toBe('needs_review');
    expect(
      oxygenFollowUpCandidatesSchema.safeParse([
        { ...candidate, follow_up_status: 'private provider text' },
      ]).success
    ).toBe(false);
    expect(
      oxygenFollowUpCandidatesSchema.safeParse([
        { ...candidate, follow_up_status: 'a'.repeat(65) },
      ]).success
    ).toBe(false);
    expect(
      oxygenFollowUpCandidatesSchema.safeParse([
        { ...candidate, follow_up_status: null },
      ]).success
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { outcomeSchema } from './partner-reconciliation-outcome';

const receipt = {
  submission_id: '20000000-0000-4000-8000-000000000001',
  partner_order_id: 'example-order',
  received_at: '2026-11-20T15:00:00Z',
};

describe('partner reconciliation outcome schema', () => {
  it('keeps a missing hold reason distinct from a recorded review hold', () => {
    expect(
      outcomeSchema.safeParse({
        receipt: { ...receipt, status: 'payment_verified' },
        hold_reason: null,
      }).success
    ).toBe(true);
    expect(
      outcomeSchema.safeParse({
        receipt: {
          ...receipt,
          status: 'review_required',
          review_reason: 'ORDER_REVIEW_REQUIRED',
        },
        hold_reason: 'ORDER_REVIEW_REQUIRED',
      }).success
    ).toBe(true);
    expect(
      outcomeSchema.safeParse({
        receipt: { ...receipt, status: 'payment_verified' },
        hold_reason: 'ORDER_REVIEW_REQUIRED',
      }).success
    ).toBe(false);
  });
});

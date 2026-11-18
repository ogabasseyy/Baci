import { describe, expect, it } from 'vitest';
import {
  oxygenFollowUpCandidatesSchema,
  oxygenFollowUpMerchantSchema,
  oxygenFollowUpOrdersSchema,
} from './oxygen-follow-up';

const id = '20000000-0000-4000-8000-000000000001';
const candidate = {
  order_id: id,
  follow_up_status: 'customer_action',
  last_activity_at: '2026-11-17T09:00:00Z',
};
const order = {
  id,
  order_number: null,
  customer_id: null,
  customer_name: null,
  customer_email: null,
  customer_phone: null,
  total: null,
  payment_status: null,
  payment_method: null,
  created_at: '2026-11-17T09:00:00Z',
  cancelled_at: null,
};

describe('Oxygen follow-up schemas', () => {
  it('requires a valid merchant UUID', () => {
    expect(oxygenFollowUpMerchantSchema.safeParse(id).success).toBe(true);
    expect(oxygenFollowUpMerchantSchema.safeParse('not-a-uuid').success).toBe(
      false
    );
  });

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

  it('accepts nullable order details but rejects malformed or excessive records', () => {
    expect(oxygenFollowUpOrdersSchema.safeParse([order]).success).toBe(true);
    expect(
      oxygenFollowUpOrdersSchema.safeParse(Array(250).fill(order)).success
    ).toBe(true);
    expect(
      oxygenFollowUpOrdersSchema.safeParse([
        { ...order, total: '12000.50', customer_id: id },
      ]).success
    ).toBe(true);
    expect(
      oxygenFollowUpOrdersSchema.safeParse(Array(251).fill(order)).success
    ).toBe(false);
    expect(
      oxygenFollowUpOrdersSchema.safeParse([
        { ...order, unexpected: 'private' },
      ]).success
    ).toBe(false);
    expect(
      oxygenFollowUpOrdersSchema.safeParse([{ ...order, id: 'invalid' }])
        .success
    ).toBe(false);
    expect(
      oxygenFollowUpOrdersSchema.safeParse([
        { ...order, created_at: 'invalid' },
      ]).success
    ).toBe(false);
    expect(
      oxygenFollowUpOrdersSchema.safeParse([{ ...order, total: {} }]).success
    ).toBe(false);
    for (const field of [
      'order_number',
      'customer_id',
      'customer_name',
      'customer_email',
      'customer_phone',
      'payment_status',
      'payment_method',
    ]) {
      expect(
        oxygenFollowUpOrdersSchema.safeParse([{ ...order, [field]: 42 }])
          .success
      ).toBe(false);
    }
  });
});

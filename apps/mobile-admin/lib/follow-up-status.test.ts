import { describe, expect, it } from 'vitest';
import type { FailedOrder } from '@/hooks/useFailedOrders';
import { getFollowUpStatusLabel } from './follow-up-status';

const order = {
  payment_status: 'unpaid',
  attempt_count: 1,
} as FailedOrder;

describe('follow-up status label', () => {
  it.each([
    ['customer_action', 'Oxygen · Customer needs to continue'],
    ['oxygen_processing', 'Oxygen · Processing'],
    ['approved_pending', 'Oxygen · Approved, action pending'],
    ['needs_review', 'Oxygen · Review needed'],
  ] as const)('shows the %s Oxygen state', (status, expected) => {
    expect(
      getFollowUpStatusLabel({
        ...order,
        oxygen_follow_up_status: status,
        attempt_count: 3,
      })
    ).toBe(expected);
  });

  it('preserves generic attempt and gateway messages', () => {
    expect(getFollowUpStatusLabel({ ...order, attempt_count: 2 })).toBe(
      '2 attempts'
    );
    expect(
      getFollowUpStatusLabel({
        ...order,
        gateway_response: { message: 'Declined by issuer' },
      })
    ).toBe('Declined by issuer');
  });

  it.each([
    ['bnpl_approved', 'BNPL Approved'],
    ['paid', 'Paid'],
    ['refunded', 'Refunded'],
    ['cancelled', 'Cancelled'],
    ['unknown', 'Payment status unavailable'],
  ] as const)('does not call %s a failed payment', (status, label) => {
    expect(getFollowUpStatusLabel({ ...order, payment_status: status })).toBe(
      label
    );
  });

  it.each([
    ['bnpl_approved', 'Staff follow-up · BNPL Approved'],
    ['paid', 'Staff follow-up · Paid'],
    ['refunded', 'Staff follow-up · Refunded'],
    ['cancelled', 'Staff follow-up · Cancelled'],
    ['pending', 'Staff follow-up'],
    ['unknown', 'Staff follow-up'],
  ] as const)('labels a retained follow-up with %s status', (status, label) => {
    expect(
      getFollowUpStatusLabel({
        ...order,
        payment_status: status,
        staff_follow_up_only: true,
      })
    ).toBe(label);
  });
});

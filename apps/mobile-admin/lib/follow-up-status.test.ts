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

  it.each([
    ['credit_direct', 'Credit Direct · Drop-off'],
    ['credit-direct', 'Credit Direct · Drop-off'],
    ['oxygen', 'Oxygen · Drop-off'],
    ['bnpl', 'BNPL Drop-off'],
  ])('names the known lender for a %s drop-off', (payment_method, label) => {
    expect(
      getFollowUpStatusLabel({
        ...order,
        payment_method,
        payment_status: 'bnpl_pending',
      })
    ).toBe(label);
  });

  it('keeps the lender visible alongside attempt counts and gateway messages', () => {
    const pending: FailedOrder = {
      ...order,
      payment_method: 'credit_direct',
      payment_status: 'bnpl_pending',
    };
    expect(getFollowUpStatusLabel({ ...pending, attempt_count: 2 })).toBe(
      'Credit Direct · 2 attempts'
    );
    expect(
      getFollowUpStatusLabel({
        ...pending,
        gateway_response: { message: 'Declined by issuer' },
      })
    ).toBe('Credit Direct · Declined by issuer');
  });

  it.each([
    ['paystack', 'Paystack · Checkout Drop-off'],
    ['card', 'Card · Checkout Drop-off'],
    ['bank_transfer', 'Bank Transfer · Checkout Drop-off'],
    ['credit_direct', 'Credit Direct · Checkout Drop-off'],
    ['unknown_method', 'Checkout Drop-off'],
  ])('labels an unpaid checkout using its saved %s method', (payment_method, label) => {
    expect(getFollowUpStatusLabel({ ...order, payment_method })).toBe(label);
  });

  it('keeps terminal status labels and labels approved financing', () => {
    const creditDirect = { ...order, payment_method: 'credit_direct' };
    expect(
      getFollowUpStatusLabel({
        ...creditDirect,
        payment_status: 'bnpl_approved',
      })
    ).toBe('Credit Direct · Approved');
    expect(
      getFollowUpStatusLabel({ ...creditDirect, payment_status: 'paid' })
    ).toBe('Paid');
  });

  it.each([
    ['paystack', 'Paystack · Checkout Drop-off'],
    ['bank_transfer', 'Bank Transfer · Checkout Drop-off'],
    ['', 'Checkout Drop-off'],
  ])('labels a pending checkout with recorded method "%s"', (payment_method, label) => {
    expect(
      getFollowUpStatusLabel({
        ...order,
        payment_method,
        payment_status: 'pending',
      })
    ).toBe(label);
  });

  it.each([
    ['failed', 'paystack', 'Paystack · Payment Failed'],
    ['failed', 'card', 'Card · Payment Failed'],
    ['expired', 'paystack', 'Paystack · Payment Expired'],
    ['expired', 'bank_transfer', 'Bank Transfer · Payment Expired'],
    ['failed', 'unknown_method', 'Payment Failed'],
    ['expired', '', 'Payment Expired'],
  ] as const)('keeps the %s wording behind a recorded "%s" method', (payment_status, payment_method, label) => {
    expect(
      getFollowUpStatusLabel({ ...order, payment_method, payment_status })
    ).toBe(label);
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

  it.each([
    [
      'credit_direct',
      'bnpl_approved',
      'Credit Direct · Staff follow-up · BNPL Approved',
    ],
    [
      'credit-direct',
      'bnpl_approved',
      'Credit Direct · Staff follow-up · BNPL Approved',
    ],
    ['paystack', 'pending', 'Staff follow-up'],
    ['paystack', 'paid', 'Staff follow-up · Paid'],
    ['unknown_method', 'bnpl_approved', 'Staff follow-up · BNPL Approved'],
    ['', 'bnpl_approved', 'Staff follow-up · BNPL Approved'],
  ] as const)('bugfix: a retained follow-up saved with method "%s" and %s status reads "%s"', (payment_method, status, label) => {
    expect(
      getFollowUpStatusLabel({
        ...order,
        payment_method,
        payment_status: status,
        staff_follow_up_only: true,
      })
    ).toBe(label);
  });
});

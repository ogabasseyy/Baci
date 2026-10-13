import { describe, expect, it } from 'vitest';
import { adminReconciliationRpcSchema } from './admin-reconciliation-rpc';

const validPayload = {
  currency: 'NGN',
  generatedAt: '2026-08-05T14:00:00+01:00',
  items: [
    {
      amount: null,
      currency: null,
      id: '123e4567-e89b-42d3-a456-426614174001',
      issueType: null,
      lane: 'platform_settlement',
      merchantId: null,
      merchantName: 'Baci',
      occurredAt: '2026-08-05T13:00:00+01:00',
      provider: 'Paystack',
      status: 'pending',
    },
    {
      amount: 2_500,
      currency: 'NGN',
      id: '123e4567-e89b-42d3-a456-426614174002',
      issueType: null,
      lane: 'payout_request',
      merchantId: '123e4567-e89b-42d3-a456-426614174000',
      merchantName: 'Baci',
      occurredAt: '2026-08-05T13:00:00+01:00',
      provider: 'wallet',
      status: 'completed',
    },
  ],
  metrics: {
    capturedPayments: 2_500,
    directSettlements: { amount: null, count: 0 },
    openReviews: 0,
    paidOrderGmv: 2_500,
    platformSettlements: {
      failedAmount: null,
      failedCount: 0,
      pendingAmount: null,
      pendingCount: 1,
      settledAmount: null,
      settledCount: 0,
    },
    payoutRequests: {
      completedAmount: 2_500,
      completedCount: 1,
      failedAmount: 0,
      failedCount: 0,
      pendingAmount: 0,
      pendingCount: 0,
    },
    refunds: {
      pendingAmount: 0,
      pendingCount: 0,
      refundedAmount: 0,
      refundedCount: 0,
    },
    wallet: { availableAmount: 2_500, pendingAmount: 0, upcomingAmount: 0 },
  },
  nextCursor: null,
  periodStart: '2026-08-01T00:00:00+01:00',
  reviewScope: 'all_unresolved',
  supportedCurrencies: ['NGN'],
} as const;

describe('adminReconciliationRpcSchema', () => {
  it('accepts currency-backed money and intentionally currencyless settlements', () => {
    const parsed = adminReconciliationRpcSchema.parse(validPayload);

    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]?.amount).toBeNull();
    expect(parsed.items[1]?.currency).toBe('NGN');
  });

  it.each([
    {
      items: [{ ...validPayload.items[0], amount: 100, currency: 'NGN' }],
    },
    { items: [{ ...validPayload.items[1], amount: null, currency: 'NGN' }] },
    { metrics: { ...validPayload.metrics, capturedPayments: -1 } },
    { nextCursor: { createdAt: '2026-08-05T14:00:00', id: 'not-a-uuid' } },
  ])('rejects unsafe reconciliation data: %o', (override) => {
    expect(
      adminReconciliationRpcSchema.safeParse({ ...validPayload, ...override })
        .success
    ).toBe(false);
  });
});

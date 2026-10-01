import { describe, expect, it } from 'vitest';
import { buildAdminReconciliationCsv } from './admin-reconciliation-csv';

describe('buildAdminReconciliationCsv', () => {
  it('withholds hostile settlement money and neutralizes spreadsheet formulas', () => {
    const csv = buildAdminReconciliationCsv({
      currency: 'NGN',
      generatedAt: '2026-08-05T10:00:00.000Z',
      items: [
        {
          amount: 50,
          currency: 'UNK',
          id: '00000000-0000-4000-8000-000000000001',
          issueType: '=HYPERLINK("unsafe")',
          lane: 'platform_settlement',
          merchantId: null,
          merchantName: '+Unsafe merchant',
          occurredAt: '2026-08-05T09:00:00.000Z',
          provider: 'reconciliation',
          status: 'open',
        },
      ],
      metrics: {
        capturedPayments: 0,
        directSettlements: { amount: null, count: 0 },
        openReviews: 1,
        paidOrderGmv: 0,
        platformSettlements: {
          failedAmount: null,
          failedCount: 0,
          pendingAmount: null,
          pendingCount: 0,
          settledAmount: null,
          settledCount: 0,
        },
        payoutRequests: {
          completedAmount: 0,
          completedCount: 0,
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
        wallet: { availableAmount: 0, pendingAmount: 0, upcomingAmount: 0 },
      },
      nextCursor: null,
      periodStart: '2026-07-06T10:00:00.000Z',
      reviewScope: 'all_unresolved',
      supportedCurrencies: ['NGN', 'USD'],
    });

    expect(csv).toContain("'+Unsafe merchant");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain('"50"');
    expect(csv).not.toContain('"UNK"');
    expect(csv).not.toContain('gateway_response');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { getAdminReconciliation } from './admin-reconciliation';

const validData = {
  currency: 'NGN',
  generatedAt: '2026-08-05T10:00:00.000Z',
  items: [],
  metrics: {
    capturedPayments: 10,
    directSettlements: { amount: null, count: 0 },
    openReviews: 0,
    paidOrderGmv: 10,
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
  supportedCurrencies: ['NGN'],
};

describe('getAdminReconciliation', () => {
  it('uses only the allowlisted RPC and validates its result', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: validData, error: null });
    const result = await getAdminReconciliation({ rpc } as never, {
      currency: 'NGN',
      format: 'json',
      lane: 'all',
      limit: 50,
      period: '30d',
      status: 'all',
    });

    expect(result.data).toEqual(validData);
    expect(rpc).toHaveBeenCalledWith('get_admin_reconciliation_v3', {
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_currency: 'NGN',
      p_lane: 'all',
      p_limit: 50,
      p_merchant_id: null,
      p_period: '30d',
      p_status: 'all',
    });
  });

  it('fails closed when the RPC sends an unsafe shape', async () => {
    const result = await getAdminReconciliation(
      {
        rpc: vi.fn().mockResolvedValue({ data: { items: [] }, error: null }),
      } as never,
      {
        currency: 'NGN',
        format: 'json',
        lane: 'all',
        limit: 50,
        period: '30d',
        status: 'all',
      }
    );

    expect(result).toMatchObject({
      data: null,
      error: { code: 'INVALID_RECONCILIATION_PAYLOAD' },
    });
  });

  it('rejects a settlement activity item that retains currency or an amount', async () => {
    const result = await getAdminReconciliation(
      {
        rpc: vi.fn().mockResolvedValue({
          data: {
            ...validData,
            items: [
              {
                amount: 1250,
                currency: 'UNK',
                id: '00000000-0000-4000-8000-000000000001',
                issueType: null,
                lane: 'platform_settlement',
                merchantId: null,
                merchantName: 'Hostile settlement',
                occurredAt: '2026-08-05T09:00:00.000Z',
                provider: 'gateway',
                status: 'settled',
              },
            ],
          },
          error: null,
        }),
      } as never,
      {
        currency: 'NGN',
        format: 'json',
        lane: 'all',
        limit: 50,
        period: '30d',
        status: 'all',
      }
    );

    expect(result).toMatchObject({
      data: null,
      error: { code: 'INVALID_RECONCILIATION_PAYLOAD' },
    });
  });
});

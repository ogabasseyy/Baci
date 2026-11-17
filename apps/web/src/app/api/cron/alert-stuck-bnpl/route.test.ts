import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getCronSecret: vi.fn<() => string | undefined>(() => 'cron-secret'),
  limit: vi.fn(),
  statusIn: vi.fn(),
  lt: vi.fn(),
  gte: vi.fn(),
  statusOr: vi.fn(),
  transactionsIn: vi.fn(),
  reviewInsert: vi.fn(),
  notifyMerchant: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/env', () => ({
  getCronSecret: mocks.getCronSecret,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    mocks.createAdminClient();
    const ordersChain = {
      select: vi.fn(),
      eq: vi.fn(),
      in: mocks.statusIn,
      lt: mocks.lt,
      gte: mocks.gte,
      or: mocks.statusOr,
      order: vi.fn(),
      limit: mocks.limit,
    };
    ordersChain.select.mockReturnValue(ordersChain);
    ordersChain.eq.mockReturnValue(ordersChain);
    mocks.statusIn.mockReturnValue(ordersChain);
    mocks.lt.mockReturnValue(ordersChain);
    mocks.gte.mockReturnValue(ordersChain);
    mocks.statusOr.mockReturnValue(ordersChain);
    ordersChain.order.mockReturnValue(ordersChain);

    const transactionsChain = {
      select: vi.fn(),
      in: mocks.transactionsIn,
    };
    transactionsChain.select.mockReturnValue(transactionsChain);

    const reconciliationReviewChain = {
      insert: mocks.reviewInsert,
    };

    return {
      from: vi.fn((table: string) => {
        if (table === 'transactions') return transactionsChain;
        if (table === 'reconciliation_review') {
          return reconciliationReviewChain;
        }
        return ordersChain;
      }),
    };
  },
}));

vi.mock('@/lib/expo-push', () => ({
  notifyMerchant: (...args: unknown[]) => mocks.notifyMerchant(...args),
  formatCurrency: (amount: number) => `₦${amount.toLocaleString()}`,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mocks.loggerWarn(...args),
    error: (...args: unknown[]) => mocks.loggerError(...args),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { GET } from './route';

function createCronRequest(auth: string | null = 'Bearer cron-secret') {
  return new NextRequest('http://localhost:3000/api/cron/alert-stuck-bnpl', {
    headers: auth ? { authorization: auth } : {},
    method: 'GET',
  });
}

function stuckOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    order_number: 'ORD-1',
    merchant_id: 'merchant-1',
    total: 100000,
    payment_method: 'credit_direct',
    payment_status: 'bnpl_pending',
    updated_at: '2026-07-01T00:00:00.000Z',
    notes:
      '{"credit_directTransactionId":"txn-1","creditDirectClientCompletedAt":"2026-07-01T00:01:00.000Z"}',
    ...overrides,
  };
}

describe('GET /api/cron/alert-stuck-bnpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCronSecret.mockReturnValue('cron-secret');
    mocks.notifyMerchant.mockResolvedValue({ sent: 1, failed: 0, errors: [] });
    mocks.limit.mockResolvedValue({ data: [], error: null });
    mocks.transactionsIn.mockResolvedValue({ data: [], error: null });
    mocks.reviewInsert.mockResolvedValue({ error: null });
  });

  it('returns 401 when the cron secret does not match', async () => {
    const response = await GET(createCronRequest('Bearer wrong-secret'));

    expect(response.status).toBe(401);
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it('returns 401 when the authorization header is missing', async () => {
    const response = await GET(createCronRequest(null));

    expect(response.status).toBe(401);
  });

  it('reports zero stuck orders without notifying anyone', async () => {
    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      stuckOrders: 0,
      alertOrders: 0,
      merchants: 0,
      merchantsNotified: 0,
    });
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
  });

  it('does not page the merchant for orders that only opened a provider session', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-abandoned',
          notes: '{"credit_directTransactionId":"txn-1"}',
        }),
      ],
      error: null,
    });

    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      stuckOrders: 1,
      alertOrders: 0,
      merchants: 0,
      merchantsNotified: 0,
    });
    expect(mocks.reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'order-abandoned' })
    );
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
  });

  it('pages only for the orders with an approval or completion signal', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-abandoned',
          total: 900000,
          notes: '{"credit_directTransactionId":"txn-1"}',
        }),
        stuckOrder({
          id: 'order-approved',
          order_number: 'ORD-APPROVED',
          total: 250000,
          payment_status: 'bnpl_approved',
          updated_at: '2020-01-01T00:00:00.000Z',
          notes: '{"credit_directTransactionId":"txn-2"}',
        }),
      ],
      error: null,
    });

    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(data.stuckOrders).toBe(2);
    expect(data.alertOrders).toBe(1);
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(1);
    expect(mocks.notifyMerchant).toHaveBeenCalledWith(
      'merchant-1',
      '⚠️ BNPL payment to confirm',
      expect.stringMatching(
        /^Order #ORD-APPROVED \(₦250,000\) went through Credit Direct checkout .* Check with Credit Direct before you fulfil it\.$/
      ),
      expect.objectContaining({
        stuck_order_count: 1,
        total_amount: 250000,
        oldest_order_id: 'order-approved',
        order_id: 'order-approved',
      }),
      'orders'
    );
  });

  it('sends one aggregated alert per merchant with stuck orders', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({ id: 'order-1', order_number: 'ORD-1', total: 100000 }),
        stuckOrder({
          id: 'order-2',
          order_number: 'ORD-2',
          total: 50000,
        }),
        stuckOrder({
          id: 'order-3',
          order_number: 'ORD-3',
          merchant_id: 'merchant-2',
          total: 25000,
        }),
      ],
      error: null,
    });

    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      stuckOrders: 3,
      alertOrders: 3,
      merchants: 2,
      merchantsNotified: 2,
    });

    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(2);
    expect(mocks.notifyMerchant).toHaveBeenCalledWith(
      'merchant-1',
      '⚠️ 2 BNPL payments to confirm',
      expect.stringContaining('2 orders totalling ₦150,000'),
      expect.objectContaining({
        type: 'stuck_bnpl_alert',
        stuck_order_count: 2,
        total_amount: 150000,
        oldest_order_id: 'order-1',
      }),
      'orders'
    );
    expect(mocks.notifyMerchant).toHaveBeenCalledWith(
      'merchant-2',
      '⚠️ BNPL payment to confirm',
      expect.stringContaining('(₦25,000) went through Credit Direct'),
      expect.objectContaining({ stuck_order_count: 1 }),
      'orders'
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'BNPL orders stuck awaiting provider confirmation',
        merchantId: 'merchant-1',
        stuckOrderCount: 2,
      })
    );
  });

  it('durably files every stuck Credit Direct order before alerting its merchant', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-pending',
          payment_status: 'bnpl_pending',
          notes: JSON.stringify({
            creditDirectSessionId: 'session-1',
            creditDirectTransactionId: 'transaction-1',
            creditDirectSignedAt: '2026-06-30T23:50:00.000Z',
          }),
        }),
        stuckOrder({
          id: 'order-approved',
          payment_status: 'bnpl_approved',
          total: '250000.50',
          notes: JSON.stringify({
            creditDirectSessionId: 'session-2',
          }),
        }),
        stuckOrder({
          id: 'order-plain-pending',
          payment_status: 'pending',
          notes: JSON.stringify({
            credit_directTransactionId: 'transaction-3',
            paymentRefUpdatedAt: '2026-07-01T00:01:00.000Z',
          }),
        }),
        stuckOrder({
          id: 'order-unpaid',
          payment_status: 'unpaid',
          notes: JSON.stringify({
            creditDirectTransactionId: 'transaction-4',
          }),
        }),
        stuckOrder({
          id: 'order-klump',
          payment_method: 'klump',
          notes: '{"klumpTransactionId":"klump-1"}',
        }),
      ],
      error: null,
    });

    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    expect(mocks.reviewInsert).toHaveBeenCalledTimes(4);
    expect(mocks.reviewInsert).toHaveBeenCalledWith({
      candidates: null,
      issue_type: 'credit_direct_confirmation_missing',
      merchant_id: 'merchant-1',
      metadata: {
        notes_evidence: {
          creditDirectSessionId: 'session-1',
          creditDirectSignedAt: '2026-06-30T23:50:00.000Z',
          creditDirectTransactionId: 'transaction-1',
          has_transaction_id_marker: true,
          parseable: true,
        },
        payment_method: 'credit_direct',
        payment_status: 'bnpl_pending',
        source: 'credit_direct_stuck_cron',
        total: 100000,
        updated_at: '2026-07-01T00:00:00.000Z',
      },
      order_id: 'order-pending',
      paystack_ref: 'transaction-1',
      reason:
        'Credit Direct order is awaiting authoritative provider confirmation',
      txn_id: null,
    });
    expect(mocks.reviewInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'order-klump' })
    );
    expect(mocks.reviewInsert.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.notifyMerchant.mock.invocationCallOrder[0]
    );
  });

  it('scans every stuck BNPL status and ages on row movement, not creation', async () => {
    await GET(createCronRequest());

    expect(mocks.statusIn).toHaveBeenCalledWith('payment_status', [
      'bnpl_pending',
      'bnpl_approved',
      'pending',
      'unpaid',
    ]);
    expect(mocks.statusIn).toHaveBeenCalledWith('payment_method', [
      'credit_direct',
      'klump',
      'credpal',
    ]);
    expect(mocks.lt).toHaveBeenCalledWith('updated_at', expect.any(String));
    expect(mocks.statusOr).toHaveBeenCalledWith(
      expect.stringMatching(
        /^payment_status\.eq\.bnpl_approved,updated_at\.gte\./
      )
    );
  });

  it('keeps old approved BNPL orders in scope while bounding unresolved pending states', async () => {
    await GET(createCronRequest());

    expect(mocks.statusOr).toHaveBeenCalledWith(
      expect.stringMatching(
        /^payment_status\.eq\.bnpl_approved,updated_at\.gte\./
      )
    );
  });

  it('warns that the report may be partial when the scan hits its limit', async () => {
    mocks.limit.mockResolvedValue({
      data: Array.from({ length: 500 }, (_, index) =>
        stuckOrder({ id: `order-${index}`, order_number: `ORD-${index}` })
      ),
      error: null,
    });

    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stuckOrders).toBe(500);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Stuck-BNPL scan hit scan limit; report may be partial',
        scanLimit: 500,
      })
    );
  });

  it('accepts a transactions row as provider evidence for pending orders without notes', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-1',
          payment_status: 'unpaid',
          payment_method: 'credpal',
          notes: null,
        }),
      ],
      error: null,
    });
    mocks.transactionsIn.mockResolvedValue({
      data: [{ order_id: 'order-1', status: 'processing' }],
      error: null,
    });

    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stuckOrders).toBe(1);
    expect(mocks.transactionsIn).toHaveBeenCalledWith('order_id', ['order-1']);
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(1);
  });

  it('files the provider reference from Credit Direct transaction evidence when notes have none', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-1',
          payment_status: 'pending',
          notes: null,
        }),
      ],
      error: null,
    });
    mocks.transactionsIn.mockResolvedValue({
      data: [
        {
          gateway_reference: 'credit-direct-reference-1',
          order_id: 'order-1',
          status: 'processing',
        },
      ],
      error: null,
    });

    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    expect(mocks.reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: 'order-1',
        paystack_ref: 'credit-direct-reference-1',
      })
    );
  });

  it('keeps session-only SDK-success evidence in the pending-order scan', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-session-only',
          payment_status: 'pending',
          notes: JSON.stringify({
            creditDirectSessionId: 'session-1',
            creditDirectClientCompletedAt: '2026-07-01T00:01:00.000Z',
          }),
        }),
      ],
      error: null,
    });

    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stuckOrders).toBe(1);
    expect(mocks.reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'order-session-only' })
    );
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(1);
    expect(mocks.transactionsIn).not.toHaveBeenCalled();
  });

  it('ignores still-pending transaction rows so initialize-flow abandoners stay excluded', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-1',
          payment_status: 'unpaid',
          payment_method: 'credpal',
          notes: null,
        }),
      ],
      error: null,
    });
    mocks.transactionsIn.mockResolvedValue({
      data: [{ order_id: 'order-1', status: 'pending' }],
      error: null,
    });

    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stuckOrders).toBe(0);
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Stuck-BNPL scan dropped pending/unpaid BNPL orders without provider evidence (possible stuck CredPal)',
        droppedCount: 1,
        orderIds: ['order-1'],
      })
    );
  });

  it('skips pending orders conservatively when the transaction-evidence check fails', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-1',
          payment_status: 'unpaid',
          payment_method: 'credpal',
          notes: null,
        }),
      ],
      error: null,
    });
    mocks.transactionsIn.mockResolvedValue({
      data: null,
      error: { message: 'transactions unavailable' },
    });

    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stuckOrders).toBe(0);
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Stuck-BNPL scan could not check transaction evidence; pending/unpaid orders without notes evidence are skipped this run',
      })
    );
    expect(mocks.loggerWarn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Stuck-BNPL scan dropped pending/unpaid BNPL orders without provider evidence (possible stuck CredPal)',
      })
    );
  });

  it('requires provider-session evidence for pending/unpaid orders', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-1',
          payment_status: 'unpaid',
          payment_method: 'credpal',
          notes: null,
        }),
        stuckOrder({
          id: 'order-2',
          payment_status: 'unpaid',
          payment_method: 'credpal',
          notes: '{"credpalTransactionId":"cp-1"}',
        }),
        stuckOrder({
          id: 'order-3',
          payment_status: 'bnpl_pending',
          notes: null,
        }),
      ],
      error: null,
    });

    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stuckOrders).toBe(2);
    // A bare provider reference keeps the order in the scan, but it is not
    // enough on its own to page the merchant.
    expect(data.alertOrders).toBe(0);
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
  });

  it('reports merchants whose push delivery failed', async () => {
    mocks.limit.mockResolvedValue({
      data: [stuckOrder()],
      error: null,
    });
    mocks.notifyMerchant.mockResolvedValue({
      sent: 0,
      failed: 1,
      errors: ['no active tokens'],
    });

    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      stuckOrders: 1,
      alertOrders: 1,
      merchants: 1,
      merchantsNotified: 0,
      pushFailures: ['merchant-1'],
    });
  });

  it('keeps alerting and reports Credit Direct review insert failures', async () => {
    mocks.limit.mockResolvedValue({
      data: [stuckOrder()],
      error: null,
    });
    mocks.reviewInsert.mockResolvedValue({
      error: { code: 'XX000', message: 'database unavailable' },
    });

    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      stuckOrders: 1,
      alertOrders: 1,
      merchants: 1,
      merchantsNotified: 1,
      reviewFailures: ['order-1'],
    });
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(1);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to file stuck Credit Direct reconciliation review',
        orderId: 'order-1',
      })
    );
  });

  it('files reviews in bounded batches and reports failures deterministically', async () => {
    const firstBatchResolvers = new Map<
      string,
      (result: { error: null | { code: string } }) => void
    >();
    mocks.limit.mockResolvedValue({
      data: Array.from({ length: 6 }, (_, index) =>
        stuckOrder({ id: `order-${index + 1}` })
      ),
      error: null,
    });
    mocks.reviewInsert.mockImplementation((row: { order_id: string }) =>
      row.order_id === 'order-6'
        ? Promise.resolve({ error: { code: 'XX000' } })
        : new Promise((resolve) => {
            firstBatchResolvers.set(row.order_id, resolve);
          })
    );

    const responsePromise = GET(createCronRequest());
    await vi.waitFor(() => {
      expect(mocks.reviewInsert).toHaveBeenCalledTimes(5);
    });
    expect(mocks.reviewInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'order-6' })
    );
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();

    firstBatchResolvers.get('order-5')?.({ error: null });
    firstBatchResolvers.get('order-2')?.({ error: { code: 'XX000' } });
    firstBatchResolvers.get('order-1')?.({ error: null });
    firstBatchResolvers.get('order-4')?.({ error: null });
    firstBatchResolvers.get('order-3')?.({ error: null });

    const response = await responsePromise;
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.reviewInsert).toHaveBeenCalledTimes(6);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(data.reviewFailures).toEqual(['order-2', 'order-6']);
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(1);
  });

  it('notifies merchants concurrently instead of waiting for each merchant serially', async () => {
    let resolveFirstPush:
      | ((value: { sent: number; failed: number }) => void)
      | undefined;
    const firstPush = new Promise<{ sent: number; failed: number }>(
      (resolve) => {
        resolveFirstPush = resolve;
      }
    );
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({ id: 'order-1', merchant_id: 'merchant-1' }),
        stuckOrder({ id: 'order-2', merchant_id: 'merchant-2' }),
      ],
      error: null,
    });
    mocks.notifyMerchant.mockImplementation((merchantId: string) =>
      merchantId === 'merchant-1'
        ? firstPush
        : Promise.resolve({ sent: 1, failed: 0 })
    );

    const responsePromise = GET(createCronRequest());
    await vi.waitFor(() => {
      expect(mocks.notifyMerchant).toHaveBeenCalledWith(
        'merchant-1',
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        'orders'
      );
      expect(mocks.notifyMerchant).toHaveBeenCalledWith(
        'merchant-2',
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        'orders'
      );
    });

    if (!resolveFirstPush) {
      throw new Error('First push resolver was not initialized');
    }
    resolveFirstPush({ sent: 1, failed: 0 });
    const response = await responsePromise;
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.merchantsNotified).toBe(2);
  });

  it('still succeeds when the push helper throws', async () => {
    mocks.limit.mockResolvedValue({
      data: [stuckOrder()],
      error: null,
    });
    mocks.notifyMerchant.mockRejectedValue(new Error('expo outage'));

    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.pushFailures).toEqual(['merchant-1']);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to push stuck-BNPL alert' })
    );
  });

  it('returns 500 when the order scan fails', async () => {
    mocks.limit.mockResolvedValue({
      data: null,
      error: { message: 'db down' },
    });

    const response = await GET(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: 'Failed to scan orders' });
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
  });
});

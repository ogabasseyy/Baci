import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fulfillPendingVtuTransactionMock } = vi.hoisted(() => ({
  fulfillPendingVtuTransactionMock: vi.fn(),
}));

vi.mock('@/lib/vtu-fulfillment', () => ({
  fulfillPendingVtuTransaction: fulfillPendingVtuTransactionMock,
}));

import { reconcileProcessingVtuTransactions } from '@/lib/vtu-processing-reconciliation';

function createProcessingQuery(response: {
  count?: null | number;
  data?: unknown;
  error?: unknown;
}) {
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    limit: vi.fn(async () => ({
      count: response.count ?? null,
      data: response.data ?? null,
      error: response.error ?? null,
    })),
    lte: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(async () => ({
      count: response.count ?? null,
      data: response.data ?? null,
      error: response.error ?? null,
    })),
    select: vi.fn(() => query),
  };
  return query;
}

function createSupabase({
  countQuery = createProcessingQuery({ count: 0 }),
  dataQuery,
}: {
  countQuery?: ReturnType<typeof createProcessingQuery>;
  dataQuery: ReturnType<typeof createProcessingQuery>;
}) {
  return {
    from: vi
      .fn()
      .mockReturnValueOnce(countQuery)
      .mockReturnValueOnce(dataQuery),
  };
}

describe('reconcileProcessingVtuTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reconciles recent processing bill transactions and summarizes outcomes', async () => {
    const countQuery = createProcessingQuery({
      count: 2,
    });
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-success' }, { id: 'tx-processing' }],
    });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock
      .mockResolvedValueOnce({ status: 'successful' })
      .mockResolvedValueOnce({ status: 'processing' });

    const result = await reconcileProcessingVtuTransactions({
      limit: 2,
      now: new Date('2026-05-07T21:14:00.000Z'),
      supabase: supabase as never,
    });

    expect(supabase.from).toHaveBeenCalledTimes(2);
    expect(countQuery.select).toHaveBeenCalledWith('id', {
      count: 'exact',
      head: true,
    });
    expect(countQuery.or).toHaveBeenCalledWith(
      'status.eq.processing,and(status.eq.pending,or(metadata->>monnifyTransientVendError.not.is.null,metadata->>preVendInterruptedAt.not.is.null)),and(status.eq.failed,source.eq.checkout,amount.gt.0,customer_id.not.is.null,metadata->>refundIssued.is.null)'
    );
    expect(countQuery.in).toHaveBeenCalledWith('type', [
      'airtime',
      'data',
      'electricity',
      'cable_tv',
      'betting',
    ]);
    expect(countQuery.lte).toHaveBeenCalledWith(
      'created_at',
      '2026-05-07T21:13:15.000Z'
    );
    expect(countQuery.limit).toHaveBeenCalledWith(1);
    expect(dataQuery.select).toHaveBeenCalledWith('id');
    expect(dataQuery.or).toHaveBeenCalledWith(
      'status.eq.processing,and(status.eq.pending,or(metadata->>monnifyTransientVendError.not.is.null,metadata->>preVendInterruptedAt.not.is.null)),and(status.eq.failed,source.eq.checkout,amount.gt.0,customer_id.not.is.null,metadata->>refundIssued.is.null)'
    );
    expect(dataQuery.lte).toHaveBeenCalledWith(
      'created_at',
      '2026-05-07T21:13:15.000Z'
    );
    expect(dataQuery.order).toHaveBeenNthCalledWith(1, 'created_at', {
      ascending: true,
    });
    expect(dataQuery.order).toHaveBeenNthCalledWith(2, 'id', {
      ascending: true,
    });
    expect(dataQuery.range).toHaveBeenCalledWith(0, 1);
    expect(fulfillPendingVtuTransactionMock).toHaveBeenNthCalledWith(1, {
      supabase,
      transactionId: 'tx-success',
    });
    expect(fulfillPendingVtuTransactionMock).toHaveBeenNthCalledWith(2, {
      supabase,
      transactionId: 'tx-processing',
    });
    expect(result).toEqual({
      checked: 2,
      errored: 0,
      errors: [],
      failed: 0,
      processing: 1,
      successful: 1,
    });
  });

  it('selects marked pending rows so interrupted debits re-vend', async () => {
    // Monnify timeouts (no vendReference: requery is PENDING forever)
    // and pre-vend interruptions (no reference at all: the reconcile
    // claim declines them) restore to marked pending so the claim →
    // re-vend flow resolves them. Plain pending rows stay excluded
    // (mapping-less orphans); failed+refund-required+unissued rows
    // (including marker-less card-only) are selected so the failed
    // branch confirms the refund even when the customer closes the
    // client instead of retrying.
    const countQuery = createProcessingQuery({ count: 1 });
    const dataQuery = createProcessingQuery({ data: [{ id: 'tx-retry' }] });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock.mockResolvedValueOnce({
      status: 'successful',
    });

    const result = await reconcileProcessingVtuTransactions({
      limit: 1,
      now: new Date('2026-05-07T21:14:00.000Z'),
      supabase: supabase as never,
    });

    const expectedFilter =
      'status.eq.processing,and(status.eq.pending,or(metadata->>monnifyTransientVendError.not.is.null,metadata->>preVendInterruptedAt.not.is.null)),and(status.eq.failed,source.eq.checkout,amount.gt.0,customer_id.not.is.null,metadata->>refundIssued.is.null)';
    expect(countQuery.or).toHaveBeenCalledWith(expectedFilter);
    expect(dataQuery.or).toHaveBeenCalledWith(expectedFilter);
    expect(fulfillPendingVtuTransactionMock).toHaveBeenCalledWith({
      supabase,
      transactionId: 'tx-retry',
    });
    expect(result.successful).toBe(1);
  });

  it('rotates reconciliation pages through the processing backlog', async () => {
    const countQuery = createProcessingQuery({
      count: 75,
    });
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-middle' }],
    });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock.mockResolvedValueOnce({
      status: 'processing',
    });

    await reconcileProcessingVtuTransactions({
      limit: 25,
      now: new Date('1970-01-01T00:05:00.000Z'),
      supabase: supabase as never,
    });

    expect(dataQuery.range).toHaveBeenCalledWith(25, 49);
    expect(fulfillPendingVtuTransactionMock).toHaveBeenCalledWith({
      supabase,
      transactionId: 'tx-middle',
    });
  });

  it('continues reconciling after one transaction throws', async () => {
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-error' }, { id: 'tx-failed' }],
    });
    const supabase = createSupabase({
      countQuery: createProcessingQuery({ count: 2 }),
      dataQuery,
    });
    fulfillPendingVtuTransactionMock
      .mockRejectedValueOnce(new Error('Kuda TSQ unavailable'))
      .mockResolvedValueOnce({ status: 'failed' });

    const result = await reconcileProcessingVtuTransactions({
      supabase: supabase as never,
    });

    expect(result).toEqual({
      checked: 2,
      errored: 1,
      errors: [
        {
          message: 'Kuda TSQ unavailable',
          transactionId: 'tx-error',
        },
      ],
      failed: 1,
      processing: 0,
      successful: 0,
    });
  });

  it('throws when processing transaction lookup fails', async () => {
    const dataQuery = createProcessingQuery({
      data: null,
      error: { message: 'database timeout' },
    });
    const supabase = createSupabase({
      countQuery: createProcessingQuery({ count: 1 }),
      dataQuery,
    });

    await expect(
      reconcileProcessingVtuTransactions({ supabase: supabase as never })
    ).rejects.toThrow(
      'Failed to fetch processing VTU transactions: database timeout'
    );
  });

  it('throws when processing transaction count fails', async () => {
    const countQuery = createProcessingQuery({
      error: { message: 'count timeout' },
    });
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-skipped' }],
    });
    const supabase = createSupabase({ countQuery, dataQuery });

    await expect(
      reconcileProcessingVtuTransactions({ supabase: supabase as never })
    ).rejects.toThrow(
      'Failed to count processing VTU transactions: count timeout'
    );
    expect(dataQuery.select).not.toHaveBeenCalled();
  });
});

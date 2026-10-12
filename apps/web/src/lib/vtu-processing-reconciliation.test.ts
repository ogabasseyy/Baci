import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fulfillPendingVtuTransactionMock, overlayReplayAttributesMock } =
  vi.hoisted(() => ({
    fulfillPendingVtuTransactionMock: vi.fn(),
    overlayReplayAttributesMock: vi.fn(),
  }));

vi.mock('@/lib/vtu-fulfillment', () => ({
  fulfillPendingVtuTransaction: fulfillPendingVtuTransactionMock,
}));

vi.mock('@/lib/vtu-replay-attribute-overlay', () => ({
  overlayReplayAttributes: overlayReplayAttributesMock,
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
    overlayReplayAttributesMock.mockResolvedValue({
      updated: false,
      refreshed: false,
    });
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
      deadlineMs: Date.now() + 3_600_000,
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
    // No client values on this path: the overlay runs in refresh-only
    // mode so a server-minted reference is fresh before each re-drive.
    expect(overlayReplayAttributesMock).toHaveBeenNthCalledWith(1, {
      supabase,
      transactionId: 'tx-success',
      customerPhone: undefined,
      validationReference: undefined,
    });
    expect(overlayReplayAttributesMock).toHaveBeenNthCalledWith(2, {
      supabase,
      transactionId: 'tx-processing',
      customerPhone: undefined,
      validationReference: undefined,
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
      deadlineMs: Date.now() + 3_600_000,
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
      deadlineMs: Date.now() + 3_600_000,
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
      deadlineMs: Date.now() + 3_600_000,
      // Window 0: rotation start 0, so the once-mocks pair with the
      // fetched order deterministically.
      now: new Date(0),
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
      reconcileProcessingVtuTransactions({
        deadlineMs: Date.now() + 3_600_000,
        supabase: supabase as never,
      })
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
      reconcileProcessingVtuTransactions({
        deadlineMs: Date.now() + 3_600_000,
        supabase: supabase as never,
      })
    ).rejects.toThrow(
      'Failed to count processing VTU transactions: count timeout'
    );
    expect(dataQuery.select).not.toHaveBeenCalled();
  });

  it('starts nothing when the deadline is already exhausted', async () => {
    const countQuery = createProcessingQuery({ count: 2 });
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-1' }, { id: 'tx-2' }],
    });
    const supabase = createSupabase({ countQuery, dataQuery });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await reconcileProcessingVtuTransactions({
        deadlineMs: Date.now() - 1_000,
        limit: 2,
        supabase: supabase as never,
      });

      expect(result).toMatchObject({ checked: 0 });
      expect(fulfillPendingVtuTransactionMock).not.toHaveBeenCalled();
      expect(overlayReplayAttributesMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'VTU reconciliation stopping early: route deadline approaching:',
        expect.objectContaining({ checked: 0, deferred: 2 })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('stops mid-batch once remaining budget drops below one worst-case row', async () => {
    // 300s deadline, 120s single-row reserve: rows cost 100s each, so
    // rows 1-2 run (t=0/100, remaining 300/200) and row 3 stops
    // (t=200, remaining 100 < 120). Leftovers ride the next rotation
    // instead of dying mid-row at maxDuration (Codex R43 rnTRm).
    vi.useFakeTimers();
    const countQuery = createProcessingQuery({ count: 3 });
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-1' }, { id: 'tx-2' }, { id: 'tx-3' }],
    });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock.mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(100_000);
      return { status: 'processing' };
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await reconcileProcessingVtuTransactions({
        deadlineMs: Date.now() + 300_000,
        limit: 3,
        supabase: supabase as never,
      });

      expect(result).toMatchObject({ checked: 2, processing: 2 });
      expect(fulfillPendingVtuTransactionMock).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        'VTU reconciliation stopping early: route deadline approaching:',
        expect.objectContaining({ checked: 2, deferred: 1 })
      );
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('rotates the intra-page start by the window number', async () => {
    // Window 2 of 3 rows: start index 2, visiting c3, c1, c2.
    const countQuery = createProcessingQuery({ count: 3 });
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-c1' }, { id: 'tx-c2' }, { id: 'tx-c3' }],
    });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock.mockResolvedValue({
      status: 'processing',
    });

    await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      now: new Date(2 * 5 * 60 * 1000),
      supabase: supabase as never,
    });

    expect(fulfillPendingVtuTransactionMock).toHaveBeenNthCalledWith(1, {
      supabase,
      transactionId: 'tx-c3',
    });
    expect(fulfillPendingVtuTransactionMock).toHaveBeenNthCalledWith(2, {
      supabase,
      transactionId: 'tx-c1',
    });
    expect(fulfillPendingVtuTransactionMock).toHaveBeenNthCalledWith(3, {
      supabase,
      transactionId: 'tx-c2',
    });
  });

  it('defers a different tail when the deadline breaks consecutive windows', async () => {
    // One row per pass (100s each, 219s budget minus the 120s
    // reserve): window 3 starts at c1, window 4 at c2, so a slow head
    // row cannot starve the same tail on every visit.
    vi.useFakeTimers();
    fulfillPendingVtuTransactionMock.mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(100_000);
      return { status: 'processing' };
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const buildSupabase = () =>
      createSupabase({
        countQuery: createProcessingQuery({ count: 3 }),
        dataQuery: createProcessingQuery({
          data: [{ id: 'tx-c1' }, { id: 'tx-c2' }, { id: 'tx-c3' }],
        }),
      });

    try {
      const first = buildSupabase();
      const firstResult = await reconcileProcessingVtuTransactions({
        deadlineMs: Date.now() + 219_000,
        now: new Date(3 * 5 * 60 * 1000),
        supabase: first as never,
      });
      expect(firstResult).toMatchObject({ checked: 1 });
      expect(fulfillPendingVtuTransactionMock).toHaveBeenLastCalledWith({
        supabase: first,
        transactionId: 'tx-c1',
      });

      fulfillPendingVtuTransactionMock.mockClear();
      const second = buildSupabase();
      const secondResult = await reconcileProcessingVtuTransactions({
        deadlineMs: Date.now() + 219_000,
        now: new Date(4 * 5 * 60 * 1000),
        supabase: second as never,
      });
      expect(secondResult).toMatchObject({ checked: 1 });
      expect(fulfillPendingVtuTransactionMock).toHaveBeenLastCalledWith({
        supabase: second,
        transactionId: 'tx-c2',
      });
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

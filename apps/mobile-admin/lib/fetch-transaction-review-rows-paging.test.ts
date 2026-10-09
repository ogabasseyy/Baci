import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  from: vi.fn(),
  gte: vi.fn(),
  gt: vi.fn(),
  in: vi.fn(),
  is: vi.fn(),
  limit: vi.fn(),
  lte: vi.fn(),
  or: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  returns: vi.fn(),
  select: vi.fn(),
}));

const query = {
  eq: mocks.eq,
  gte: mocks.gte,
  gt: mocks.gt,
  in: mocks.in,
  is: mocks.is,
  limit: mocks.limit,
  lte: mocks.lte,
  or: mocks.or,
  order: mocks.order,
  range: mocks.range,
  returns: mocks.returns,
  select: mocks.select,
};

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.in.mockReturnValue(query);
  mocks.is.mockReturnValue(query);
  mocks.order.mockReturnValue(query);
  mocks.or.mockReturnValue(query);
  mocks.gte.mockReturnValue(query);
  mocks.gt.mockReturnValue(query);
  mocks.lte.mockReturnValue(query);
  mocks.limit.mockReturnValue({ returns: mocks.returns });
  mocks.range.mockReturnValue({ returns: mocks.returns });
  mocks.returns.mockResolvedValue({ data: [], error: null });
});

it('orders same-date fetch-all rows by recency before id', async () => {
  const { fetchTransactionReviewRows } = await import(
    './fetch-transaction-review-rows'
  );
  mocks.returns.mockResolvedValueOnce({
    data: [
      {
        created_at: '2026-10-01T10:00:00.000Z',
        id: 'older-created',
        transaction_date: '2026-10-05T00:00:00.000Z',
      },
      {
        created_at: '2026-10-02T10:00:00.000Z',
        id: 'newer-created',
        transaction_date: '2026-10-05T00:00:00.000Z',
      },
    ],
    error: null,
  });

  const result = await fetchTransactionReviewRows({
    fetchAll: true,
    includeCancelledAt: true,
    includeTransactionDate: true,
    merchantId: 'merchant-1',
    selectStatement: 'id',
  });

  expect(result.error).toBeNull();
  expect(result.data?.map((row) => row.id)).toEqual([
    'newer-created',
    'older-created',
  ]);
});

it('searches an older IMEI beyond the first database page', async () => {
  const { fetchTransactionReviewRows } = await import(
    './fetch-transaction-review-rows'
  );
  const { mapTransactionOrderRows, filterTransactionOrders } = await import(
    './transaction-review'
  );
  const row = {
    id: 'older-order',
    created_at: '2025-01-01T00:00:00Z',
    transaction_date: '2025-06-01T00:00:00Z',
    customer_email: null,
    customer_name: 'Older customer',
    customer_phone: null,
    fulfillment_details: { imei: '354066782325743' },
    order_items: [],
    order_number: 'OLD-1',
    payment_method: 'card',
    total: 100,
  };
  // Queued in fetch order: the scan primes the dated stream, then the
  // undated stream (empty here: a dated row cannot come from the undated
  // filter), then refills the dated stream with the IMEI row. If dated
  // keyset pagination never refills, the IMEI match is absent.
  mocks.returns
    .mockResolvedValueOnce({
      data: Array.from({ length: 200 }, (_, index) => ({
        ...row,
        id: `a-${String(index).padStart(3, '0')}`,
        fulfillment_details: null,
      })),
      error: null,
    })
    .mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValueOnce({ data: [row], error: null });

  const result = await fetchTransactionReviewRows({
    includeCancelledAt: true,
    includeTransactionDate: true,
    merchantId: 'merchant-1',
    fetchAll: true,
    selectStatement: 'id, fulfillment_details',
  });
  expect(result.data).toHaveLength(201);
  expect(result.truncated).toBe(false);
  const matches = filterTransactionOrders(
    mapTransactionOrderRows(result.data ?? []),
    '354066782325743'
  );
  expect(matches.map((order) => order.id)).toEqual(['older-order']);
  expect(mocks.order).toHaveBeenCalledWith('transaction_date', {
    ascending: false,
    nullsFirst: false,
  });
  expect(mocks.order).toHaveBeenCalledWith('created_at', {
    ascending: false,
  });
  expect(mocks.order).toHaveBeenCalledWith('id', { ascending: false });
  expect(mocks.or).toHaveBeenCalledWith(
    expect.stringContaining('or(transaction_date.not.is.null)')
  );
  expect(mocks.or).toHaveBeenCalledWith(
    expect.stringContaining('or(transaction_date.is.null)')
  );
  expect(mocks.or).toHaveBeenCalledWith(
    expect.stringContaining(
      'or(transaction_date.lt.2025-06-01T00:00:00Z,and(transaction_date.eq.2025-06-01T00:00:00Z,created_at.lt.2025-01-01T00:00:00Z),and(transaction_date.eq.2025-06-01T00:00:00Z,created_at.eq.2025-01-01T00:00:00Z,id.lt.a-199))'
    )
  );
  expect(mocks.gt).not.toHaveBeenCalled();
  expect(mocks.eq).toHaveBeenCalledWith('payment_status', 'paid');
  expect(mocks.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
});

it('finds a re-dated order by transaction date even though its creation time is old', async () => {
  const { fetchTransactionReviewRows } = await import(
    './fetch-transaction-review-rows'
  );
  // A created_at-ordered scan would page this row after every recently
  // created order; the dated stream ranks it by its recent transaction date.
  const redatedRow = {
    created_at: '2020-01-01T00:00:00Z',
    id: 'redated-order',
    transaction_date: '2026-10-04T00:00:00Z',
  };
  // Queued in fetch order: dated prime, empty undated prime, dated refill.
  mocks.returns
    .mockResolvedValueOnce({
      data: Array.from({ length: 200 }, (_, index) => ({
        created_at: '2026-10-06T00:00:00Z',
        id: `recent-${String(index).padStart(3, '0')}`,
        transaction_date: '2026-10-05T00:00:00Z',
      })),
      error: null,
    })
    .mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValueOnce({ data: [redatedRow], error: null });

  const result = await fetchTransactionReviewRows({
    fetchAll: true,
    includeCancelledAt: true,
    includeTransactionDate: true,
    merchantId: 'merchant-1',
    selectStatement: 'id',
  });

  expect(result.error).toBeNull();
  expect(result.data).toHaveLength(201);
  expect(result.data?.map((row) => row.id)).toContain('redated-order');
  // Effective-date rank: the re-dated row sorts after the newer dated rows.
  expect(result.data?.[200]?.id).toBe('redated-order');
  expect(mocks.order.mock.calls[0]).toEqual([
    'transaction_date',
    { ascending: false, nullsFirst: false },
  ]);
  expect(mocks.or).toHaveBeenCalledWith(
    expect.stringContaining('transaction_date.lt.2026-10-05T00:00:00Z')
  );
});

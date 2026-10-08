import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('fetchTransactionReviewRows', () => {
  it('excludes cancelled orders when cancelled_at is available', async () => {
    const { fetchTransactionReviewRows } = await import(
      './fetch-transaction-review-rows'
    );

    await fetchTransactionReviewRows({
      includeCancelledAt: true,
      includeTransactionDate: true,
      merchantId: 'merchant-1',
      selectStatement: 'id',
    });

    expect(mocks.is).toHaveBeenCalledWith('cancelled_at', null);
    expect(mocks.or).toHaveBeenCalledWith(
      'shipping_status.is.null,shipping_status.not.in.(cancelled,canceled,returned)'
    );
  });

  it('keeps the fallback query usable without cancelled_at', async () => {
    const { fetchTransactionReviewRows } = await import(
      './fetch-transaction-review-rows'
    );

    await fetchTransactionReviewRows({
      includeCancelledAt: false,
      includeTransactionDate: true,
      merchantId: 'merchant-1',
      selectStatement: 'id, shipping_status',
    });

    expect(mocks.is).not.toHaveBeenCalled();
    expect(mocks.or).toHaveBeenCalledWith(
      'shipping_status.is.null,shipping_status.not.in.(cancelled,canceled,returned)'
    );
  });

  it('hydrates only the requested order ids', async () => {
    const { fetchTransactionReviewRows } = await import(
      './fetch-transaction-review-rows'
    );

    await fetchTransactionReviewRows({
      includeCancelledAt: true,
      includeTransactionDate: false,
      merchantId: 'merchant-1',
      orderIds: ['order-1', 'order-2'],
      selectStatement: 'id',
    });

    expect(mocks.in).toHaveBeenCalledWith('id', ['order-1', 'order-2']);
    expect(mocks.limit).toHaveBeenCalledWith(2);
  });

  it('orders same-date fetch-all rows by recency before id', async () => {
    const { fetchTransactionReviewRows } = await import(
      './fetch-transaction-review-rows'
    );
    mocks.returns.mockResolvedValue({
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
    customer_email: null,
    customer_name: 'Older customer',
    customer_phone: null,
    fulfillment_details: { imei: '354066782325743' },
    order_items: [],
    order_number: 'OLD-1',
    payment_method: 'card',
    total: 100,
  };
  mocks.returns
    .mockResolvedValueOnce({
      data: Array.from({ length: 200 }, (_, index) => ({
        ...row,
        id: `a-${String(index).padStart(3, '0')}`,
        fulfillment_details: null,
      })),
      error: null,
    })
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
  expect(mocks.gt).toHaveBeenCalledWith('id', 'a-199');
  expect(mocks.eq).toHaveBeenCalledWith('payment_status', 'paid');
  expect(mocks.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
});

it('caps the legacy scan and reports truncation instead of paging forever', async () => {
  const { fetchTransactionReviewRows } = await import(
    './fetch-transaction-review-rows'
  );
  // Eleven full pages: the eleventh must never be requested.
  for (let page = 0; page < 11; page += 1) {
    mocks.returns.mockResolvedValueOnce({
      data: Array.from({ length: 200 }, (_, index) => ({
        created_at: '2025-01-01T00:00:00Z',
        id: `p${page}-${String(index).padStart(3, '0')}`,
      })),
      error: null,
    });
  }
  const result = await fetchTransactionReviewRows({
    includeCancelledAt: true,
    includeTransactionDate: false,
    merchantId: 'merchant-1',
    fetchAll: true,
    selectStatement: 'id',
  });
  expect(result.error).toBeNull();
  expect(result.data).toHaveLength(2000);
  expect(result.truncated).toBe(true);
  expect(mocks.returns).toHaveBeenCalledTimes(10);
});

it('returns an error rather than incomplete searchable history when a later page fails', async () => {
  const { fetchTransactionReviewRows } = await import(
    './fetch-transaction-review-rows'
  );
  const error = { message: 'Network error' };
  mocks.returns
    .mockResolvedValueOnce({
      data: Array.from({ length: 200 }, () => ({ id: 'row' })),
      error: null,
    })
    .mockResolvedValueOnce({ data: null, error });
  const result = await fetchTransactionReviewRows({
    includeCancelledAt: true,
    includeTransactionDate: false,
    merchantId: 'merchant-1',
    fetchAll: true,
    selectStatement: 'id',
  });
  expect(result.error).toEqual(error);
  expect(result.data).toBeNull();
});

it('keeps ordinary browsing bounded to the recent window', async () => {
  const { fetchTransactionReviewRows } = await import(
    './fetch-transaction-review-rows'
  );
  await fetchTransactionReviewRows({
    includeCancelledAt: true,
    includeTransactionDate: true,
    merchantId: 'merchant-1',
    selectStatement: 'id',
  });
  expect(mocks.limit).toHaveBeenCalledWith(40);
});

it('applies both month boundaries and cancellation visibility in a single logical filter', async () => {
  const { fetchTransactionReviewRows } = await import(
    './fetch-transaction-review-rows'
  );
  await fetchTransactionReviewRows({
    includeCancelledAt: true,
    includeTransactionDate: true,
    merchantId: 'merchant-1',
    selectStatement: 'id',
    startDateFilter: 'transaction_date.gte.2026-10-01',
    endDateFilter: 'transaction_date.lte.2026-10-08',
  });
  expect(mocks.or).toHaveBeenCalledTimes(1);
  expect(mocks.or).toHaveBeenCalledWith(
    'and(or(shipping_status.is.null,shipping_status.not.in.(cancelled,canceled,returned)),or(transaction_date.gte.2026-10-01),or(transaction_date.lte.2026-10-08))'
  );
});

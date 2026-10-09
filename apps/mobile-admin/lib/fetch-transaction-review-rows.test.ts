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

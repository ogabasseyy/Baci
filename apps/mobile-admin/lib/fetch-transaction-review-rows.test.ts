import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  from: vi.fn(),
  gte: vi.fn(),
  is: vi.fn(),
  limit: vi.fn(),
  lte: vi.fn(),
  or: vi.fn(),
  order: vi.fn(),
  select: vi.fn(),
}));

const query = {
  eq: mocks.eq,
  gte: mocks.gte,
  is: mocks.is,
  limit: mocks.limit,
  lte: mocks.lte,
  or: mocks.or,
  order: mocks.order,
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
  mocks.is.mockReturnValue(query);
  mocks.order.mockReturnValue(query);
  mocks.or.mockReturnValue(query);
  mocks.gte.mockReturnValue(query);
  mocks.lte.mockReturnValue(query);
  mocks.limit.mockResolvedValue({ data: [], error: null });
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
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  from: vi.fn(),
  gte: vi.fn(),
  is: vi.fn(),
  lte: vi.fn(),
  or: vi.fn(),
  select: vi.fn(),
}));

const query = {
  eq: mocks.eq,
  gte: mocks.gte,
  is: mocks.is,
  lte: mocks.lte,
  or: mocks.or,
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
  mocks.gte.mockReturnValue(query);
  mocks.lte.mockReturnValue(query);
  mocks.or.mockResolvedValue({ count: 7, error: null });
});

describe('fetchTransactionReviewCount', () => {
  it('requests an exact head count with the review filters', async () => {
    const { fetchTransactionReviewCount } = await import(
      './fetch-transaction-review-count'
    );

    const result = await fetchTransactionReviewCount({
      endDateIso: '2026-10-31T23:59:59.999Z',
      merchantId: 'merchant-1',
      startDateIso: '2026-10-01T00:00:00.000Z',
    });

    expect(mocks.from).toHaveBeenCalledWith('orders');
    expect(mocks.select).toHaveBeenCalledWith('id', {
      count: 'exact',
      head: true,
    });
    expect(mocks.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(mocks.eq).toHaveBeenCalledWith('payment_status', 'paid');
    expect(mocks.is).toHaveBeenCalledWith('cancelled_at', null);
    expect(mocks.or).toHaveBeenCalledWith(
      expect.stringContaining('shipping_status.is.null')
    );
    expect(mocks.gte).not.toHaveBeenCalled();
    expect(mocks.lte).not.toHaveBeenCalled();
    expect(result).toEqual({ count: 7, error: null });
  });

  it('falls back to created_at when transaction_date is missing', async () => {
    const { fetchTransactionReviewCount } = await import(
      './fetch-transaction-review-count'
    );
    mocks.or
      .mockResolvedValueOnce({
        count: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'transaction_date' column of 'orders' in the schema cache",
        },
      })
      .mockResolvedValue({ count: 3, error: null });

    const result = await fetchTransactionReviewCount({
      endDateIso: '2026-10-31T23:59:59.999Z',
      merchantId: 'merchant-1',
      startDateIso: '2026-10-01T00:00:00.000Z',
    });

    expect(mocks.or).toHaveBeenCalledTimes(2);
    expect(mocks.gte).toHaveBeenCalledWith(
      'created_at',
      '2026-10-01T00:00:00.000Z'
    );
    expect(mocks.lte).toHaveBeenCalledWith(
      'created_at',
      '2026-10-31T23:59:59.999Z'
    );
    expect(result).toEqual({ count: 3, error: null });
  });

  it('retries without the cancelled filter when cancelled_at is missing', async () => {
    const { fetchTransactionReviewCount } = await import(
      './fetch-transaction-review-count'
    );
    mocks.or
      .mockResolvedValueOnce({
        count: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'cancelled_at' column of 'orders' in the schema cache",
        },
      })
      .mockResolvedValue({ count: 5, error: null });

    const result = await fetchTransactionReviewCount({
      merchantId: 'merchant-1',
    });

    expect(mocks.or).toHaveBeenCalledTimes(2);
    expect(mocks.is).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ count: 5, error: null });
  });

  it('retries the same query once on an unnamed schema-cache error', async () => {
    const { fetchTransactionReviewCount } = await import(
      './fetch-transaction-review-count'
    );
    mocks.or
      .mockResolvedValueOnce({
        count: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'merchant_id' column of 'orders' in the schema cache",
        },
      })
      .mockResolvedValue({ count: 4, error: null });

    const result = await fetchTransactionReviewCount({
      merchantId: 'merchant-1',
    });

    expect(mocks.or).toHaveBeenCalledTimes(2);
    expect(mocks.gte).not.toHaveBeenCalled();
    expect(mocks.lte).not.toHaveBeenCalled();
    expect(result).toEqual({ count: 4, error: null });
  });

  it('surfaces a persistent schema-cache error after one retry', async () => {
    const { fetchTransactionReviewCount } = await import(
      './fetch-transaction-review-count'
    );
    const error = {
      code: 'PGRST204',
      message:
        "Could not find the 'merchant_id' column of 'orders' in the schema cache",
    };
    mocks.or.mockResolvedValue({ count: null, error });

    const result = await fetchTransactionReviewCount({
      merchantId: 'merchant-1',
    });

    expect(mocks.or).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ count: null, error });
  });

  it('surfaces unrelated errors without retrying', async () => {
    const { fetchTransactionReviewCount } = await import(
      './fetch-transaction-review-count'
    );
    const error = { message: 'insufficient_privilege' };
    mocks.or.mockResolvedValue({ count: null, error });

    const result = await fetchTransactionReviewCount({
      merchantId: 'merchant-1',
    });

    expect(mocks.or).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ count: null, error });
  });
});

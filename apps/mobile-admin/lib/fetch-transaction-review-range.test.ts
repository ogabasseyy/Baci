import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchTransactionReviewWithFallbacks: vi.fn(),
}));

vi.mock('./fetch-transaction-review-with-fallbacks', () => ({
  fetchTransactionReviewWithFallbacks:
    mocks.fetchTransactionReviewWithFallbacks,
}));

describe('fetchTransactionReviewRange', () => {
  it('passes filters through and maps the window', async () => {
    const { fetchTransactionReviewRange } = await import(
      './fetch-transaction-review-range'
    );
    mocks.fetchTransactionReviewWithFallbacks.mockResolvedValue({
      data: [],
      error: null,
      truncated: false,
    });

    const result = await fetchTransactionReviewRange({
      endDateIso: '2026-10-31',
      merchantId: 'merchant-1',
      startDateIso: '2026-10-01',
    });

    expect(mocks.fetchTransactionReviewWithFallbacks).toHaveBeenCalledWith({
      endDateIso: '2026-10-31',
      merchantId: 'merchant-1',
      startDateIso: '2026-10-01',
    });
    expect(result).toEqual({ orders: [], truncated: false });
  });

  it('requests the full bounded range with truncation state', async () => {
    const { fetchTransactionReviewRange } = await import(
      './fetch-transaction-review-range'
    );
    mocks.fetchTransactionReviewWithFallbacks.mockResolvedValue({
      data: [],
      error: null,
      truncated: true,
    });

    const result = await fetchTransactionReviewRange({
      fetchAll: true,
      merchantId: 'merchant-1',
    });

    expect(mocks.fetchTransactionReviewWithFallbacks).toHaveBeenCalledWith({
      fetchAll: true,
      merchantId: 'merchant-1',
    });
    expect(result.truncated).toBe(true);
  });

  it('throws when the range query fails', async () => {
    const { fetchTransactionReviewRange } = await import(
      './fetch-transaction-review-range'
    );
    mocks.fetchTransactionReviewWithFallbacks.mockResolvedValue({
      data: null,
      error: { message: 'range boom' },
      truncated: false,
    });

    await expect(
      fetchTransactionReviewRange({ merchantId: 'merchant-1' })
    ).rejects.toThrow('range boom');
  });
});

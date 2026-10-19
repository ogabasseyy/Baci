import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchTransactionReviewRows } = vi.hoisted(() => ({
  mockFetchTransactionReviewRows: vi.fn(),
}));

vi.mock('./fetch-transaction-review-rows', () => ({
  fetchTransactionReviewRows: mockFetchTransactionReviewRows,
}));

import { runTransactionReviewQueryWithTaxFallback } from './run-transaction-review-query-with-tax-fallback';

const options = {
  endDateIso: '2026-08-28T23:59:59.999Z',
  includeCancelledAt: true,
  includeTransactionDate: false,
  merchantId: 'merchant-1',
  selectStatement: 'id, tax_amount',
  startDateIso: '2026-08-01T00:00:00.000Z',
};

describe('runTransactionReviewQueryWithTaxFallback', () => {
  beforeEach(() => {
    mockFetchTransactionReviewRows.mockReset();
  });

  it('retries with the tax-free selector when tax amount is unavailable', async () => {
    const rows = [{ id: 'tax-fallback-order' }];
    const taxAmountError = {
      code: 'PGRST204',
      message:
        "Could not find the 'tax_amount' column of 'orders' in the schema cache",
    };
    mockFetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: taxAmountError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await runTransactionReviewQueryWithTaxFallback(
      'Full',
      options,
      {
        selectStatement: 'id',
        stage: 'FullNoTaxAmount',
      }
    );

    expect(result).toEqual({ data: rows, error: null });
    expect(mockFetchTransactionReviewRows).toHaveBeenNthCalledWith(1, options);
    expect(mockFetchTransactionReviewRows).toHaveBeenNthCalledWith(2, {
      ...options,
      selectStatement: 'id',
    });
  });

  it('returns a successful query without issuing an unnecessary retry', async () => {
    const rows = [{ id: 'rich-order' }];
    mockFetchTransactionReviewRows.mockResolvedValueOnce({
      data: rows,
      error: null,
    });

    await expect(
      runTransactionReviewQueryWithTaxFallback('Full', options, {
        selectStatement: 'id',
        stage: 'FullNoTaxAmount',
      })
    ).resolves.toEqual({ data: rows, error: null });
    expect(mockFetchTransactionReviewRows).toHaveBeenCalledTimes(1);
  });
});

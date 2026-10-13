import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchTransactionReviewRows } = vi.hoisted(() => ({
  mockFetchTransactionReviewRows: vi.fn(),
}));

vi.mock('./fetch-transaction-review-rows', () => ({
  fetchTransactionReviewRows: mockFetchTransactionReviewRows,
}));

import { runBaseTransactionReviewQuery } from './run-base-transaction-review-query';

describe('runBaseTransactionReviewQuery', () => {
  beforeEach(() => {
    mockFetchTransactionReviewRows.mockReset();
  });

  it('builds base options without transaction-date ordering', async () => {
    const rows = [{ id: 'base-order' }];
    mockFetchTransactionReviewRows.mockResolvedValueOnce({
      data: rows,
      error: null,
    });

    const result = await runBaseTransactionReviewQuery(
      'BaseWithDiscount',
      {
        endDateFilter: 'transaction_date.lte.2026-08-28',
        endDateIso: '2026-08-28T23:59:59.999Z',
        merchantId: 'merchant-1',
        startDateFilter: 'transaction_date.gte.2026-08-01',
        startDateIso: '2026-08-01T00:00:00.000Z',
      },
      'id, total',
      false
    );

    expect(result).toEqual({ data: rows, error: null });
    expect(mockFetchTransactionReviewRows).toHaveBeenCalledWith({
      endDateIso: '2026-08-28T23:59:59.999Z',
      includeCancelledAt: false,
      includeTransactionDate: false,
      merchantId: 'merchant-1',
      selectStatement: 'id, total',
      startDateIso: '2026-08-01T00:00:00.000Z',
    });
  });

  it('uses the supplied tax fallback for a base projection', async () => {
    const taxAmountError = {
      code: 'PGRST204',
      message:
        "Could not find the 'tax_amount' column of 'orders' in the schema cache",
    };
    mockFetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: taxAmountError })
      .mockResolvedValueOnce({
        data: [{ id: 'base-tax-fallback' }],
        error: null,
      });

    await expect(
      runBaseTransactionReviewQuery(
        'BaseWithDiscount',
        { merchantId: 'merchant-1' },
        'id, tax_amount',
        true,
        { selectStatement: 'id', stage: 'BaseWithDiscountNoTaxAmount' }
      )
    ).resolves.toEqual({ data: [{ id: 'base-tax-fallback' }], error: null });

    expect(mockFetchTransactionReviewRows).toHaveBeenCalledTimes(2);
    expect(mockFetchTransactionReviewRows.mock.calls[1]?.[0]).toEqual({
      includeCancelledAt: true,
      includeTransactionDate: false,
      merchantId: 'merchant-1',
      selectStatement: 'id',
    });
  });
});

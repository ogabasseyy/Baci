import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchTransactionReviewRows } = vi.hoisted(() => ({
  mockFetchTransactionReviewRows: vi.fn(),
}));

vi.mock('./fetch-transaction-review-rows', () => ({
  fetchTransactionReviewRows: mockFetchTransactionReviewRows,
}));

import { runLegacyTransactionReviewQuery } from './run-legacy-transaction-review-query';

describe('runLegacyTransactionReviewQuery', () => {
  beforeEach(() => {
    mockFetchTransactionReviewRows.mockReset();
  });

  it('preserves legacy date filters and transaction-date ordering', async () => {
    const rows = [{ id: 'legacy-order' }];
    mockFetchTransactionReviewRows.mockResolvedValueOnce({
      data: rows,
      error: null,
    });

    await expect(
      runLegacyTransactionReviewQuery(
        'Legacy',
        {
          endDateFilter: 'transaction_date.lte.2026-08-28',
          endDateIso: '2026-08-28T23:59:59.999Z',
          merchantId: 'merchant-1',
          startDateFilter: 'transaction_date.gte.2026-08-01',
          startDateIso: '2026-08-01T00:00:00.000Z',
        },
        'id, transaction_date',
        true
      )
    ).resolves.toEqual({ data: rows, error: null });

    expect(mockFetchTransactionReviewRows).toHaveBeenCalledWith({
      endDateFilter: 'transaction_date.lte.2026-08-28',
      endDateIso: '2026-08-28T23:59:59.999Z',
      includeCancelledAt: true,
      includeTransactionDate: true,
      merchantId: 'merchant-1',
      selectStatement: 'id, transaction_date',
      startDateFilter: 'transaction_date.gte.2026-08-01',
      startDateIso: '2026-08-01T00:00:00.000Z',
    });
  });

  it('uses a tax-free retry while retaining the requested legacy options', async () => {
    const taxAmountError = {
      code: 'PGRST204',
      message:
        "Could not find the 'tax_amount' column of 'orders' in the schema cache",
    };
    mockFetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: taxAmountError })
      .mockResolvedValueOnce({
        data: [{ id: 'legacy-tax-fallback' }],
        error: null,
      });

    await expect(
      runLegacyTransactionReviewQuery(
        'Legacy',
        { merchantId: 'merchant-1' },
        'id, tax_amount',
        false,
        { selectStatement: 'id', stage: 'LegacyNoTaxAmount' },
        false
      )
    ).resolves.toEqual({ data: [{ id: 'legacy-tax-fallback' }], error: null });

    expect(mockFetchTransactionReviewRows).toHaveBeenNthCalledWith(2, {
      includeCancelledAt: false,
      includeTransactionDate: false,
      merchantId: 'merchant-1',
      selectStatement: 'id',
    });
  });
});

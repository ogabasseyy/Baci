import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchTransactionReviewRows: vi.fn(),
}));

vi.mock('./fetch-transaction-review-rows', () => ({
  fetchTransactionReviewRows: mocks.fetchTransactionReviewRows,
}));

import { fetchTransactionReviewWithFallbacks } from './fetch-transaction-review-with-fallbacks';

const schemaCacheError = {
  code: 'PGRST204',
  message:
    "Could not find the 'variant_id' column of 'order_items' in the schema cache",
};

describe('fetchTransactionReviewWithFallbacks cost fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tries the rich legacy projection before the discount-only compatibility fallback', async () => {
    const rows = [{ id: 'legacy-cost-order' }];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      mocks.fetchTransactionReviewRows.mockResolvedValueOnce({
        data: null,
        error: schemaCacheError,
      });
    }
    mocks.fetchTransactionReviewRows.mockResolvedValueOnce({
      data: rows,
      error: null,
    });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(6);
    const richProjectionSelectors = mocks.fetchTransactionReviewRows.mock.calls
      .map(([options]) => options.selectStatement)
      .filter((selector) => selector.includes('product_variants'));
    expect(richProjectionSelectors.length).toBeGreaterThan(0);
    expect(
      richProjectionSelectors[richProjectionSelectors.length - 1]
    ).toContain('cost_price');
  });

  it('preserves cost snapshots when discount codes and unit-cost relations are unavailable', async () => {
    const rows = [{ id: 'legacy-discount-code-order' }];
    const discountCodeSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'discount_code_id' column of 'orders' in the schema cache",
    };
    const unitCostSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'order_item_unit_costs' relationship in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: discountCodeSchemaError })
      .mockResolvedValueOnce({ data: null, error: unitCostSchemaError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(3);
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[2][0].selectStatement
    ).not.toContain('order_item_unit_costs');
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[2][0].selectStatement
    ).not.toContain('discount_code_id');
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[2][0].selectStatement
    ).toContain('assurance_fee');
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[2][0].selectStatement
    ).toContain('vat_rate');
  });

  it('preserves discount provenance when the date and discount-code columns are unavailable', async () => {
    const rows = [{ id: 'legacy-base-discount-code-order' }];
    const transactionDateSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'transaction_date' column of 'orders' in the schema cache",
    };
    const discountCodeSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'discount_code_id' column of 'orders' in the schema cache",
    };

    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: transactionDateSchemaError })
      .mockResolvedValueOnce({ data: null, error: transactionDateSchemaError })
      .mockResolvedValueOnce({ data: null, error: transactionDateSchemaError })
      .mockResolvedValueOnce({ data: null, error: discountCodeSchemaError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(5);
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[3][0].selectStatement
    ).toContain('discount_code_id');
    const fallbackSelector =
      mocks.fetchTransactionReviewRows.mock.calls[4][0].selectStatement;
    expect(fallbackSelector).not.toContain('discount_code_id');
    expect(fallbackSelector).toContain('discount_amount');
    expect(fallbackSelector).toContain('tax_amount');
    expect(fallbackSelector).toContain('ad_tracking');
  });

  it('falls back to the cost projection when adjustment columns are unavailable', async () => {
    const rows = [{ id: 'legacy-discount-code-order' }];
    const discountCodeSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'discount_code_id' column of 'orders' in the schema cache",
    };
    const assuranceSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'assurance_fee' column of 'order_items' in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: discountCodeSchemaError })
      .mockResolvedValueOnce({ data: null, error: assuranceSchemaError })
      .mockResolvedValueOnce({ data: null, error: discountCodeSchemaError })
      .mockResolvedValueOnce({ data: null, error: discountCodeSchemaError })
      .mockResolvedValueOnce({ data: null, error: assuranceSchemaError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(6);
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[5][0].selectStatement
    ).toContain('order_item_unit_costs');
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[5][0].selectStatement
    ).not.toContain('assurance_fee');
  });

  it('keeps per-unit costs when cancellation filtering is unavailable', async () => {
    const rows = [{ id: 'cancelled-at-cost-order' }];
    const cancelledAtSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'cancelled_at' column of 'orders' in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: cancelledAtSchemaError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(2);
    const [options] = mocks.fetchTransactionReviewRows.mock.calls[1] ?? [];
    expect(options).toEqual(
      expect.objectContaining({ includeCancelledAt: false })
    );
    expect(options.selectStatement).not.toContain('cancelled_at');
    expect(options.selectStatement).toContain('order_item_unit_costs');
  });
});

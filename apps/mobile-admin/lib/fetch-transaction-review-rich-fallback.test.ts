import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRichTransactionReviewRows } from './fetch-transaction-review-rich-fallback';

const { mockFetchTransactionReviewRows } = vi.hoisted(() => ({
  mockFetchTransactionReviewRows: vi.fn(),
}));

vi.mock('./fetch-transaction-review-rows', () => ({
  fetchTransactionReviewRows: mockFetchTransactionReviewRows,
}));

describe('fetchRichTransactionReviewRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries a rich projection without tax when that column is unavailable', async () => {
    const rows = [{ id: 'rich-tax-fallback-order' }];
    mockFetchTransactionReviewRows
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'tax_amount' column of 'orders' in the schema cache",
        },
      })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchRichTransactionReviewRows({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mockFetchTransactionReviewRows).toHaveBeenCalledTimes(2);
    const selector = mockFetchTransactionReviewRows.mock.calls[1][0]
      .selectStatement as string;
    expect(selector).not.toContain('tax_amount');
    expect(selector).toContain('discount_amount');
    expect(selector).toContain('discount_code_id');
    expect(selector).toContain('order_item_unit_costs');
  });

  it('retains rich costs when variant attributes and match status are unavailable together', async () => {
    const rows = [{ id: 'variant-and-match-fallback-order' }];
    mockFetchTransactionReviewRows
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'variant_attributes' column of 'order_items' in the schema cache",
        },
      })
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'product_match_status' column of 'order_items' in the schema cache",
        },
      })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchRichTransactionReviewRows({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mockFetchTransactionReviewRows).toHaveBeenCalledTimes(3);
    const selector = mockFetchTransactionReviewRows.mock.calls[2][0]
      .selectStatement as string;
    expect(selector).not.toContain('variant_attributes');
    expect(selector).not.toContain('product_match_status');
    expect(selector).toContain('discount_code_id');
    expect(selector).toContain('order_item_unit_costs');
  });

  it('retains unit-cost snapshots when variant attributes and discount codes are unavailable together', async () => {
    const rows = [{ id: 'variant-and-discount-fallback-order' }];
    mockFetchTransactionReviewRows
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'variant_attributes' column of 'order_items' in the schema cache",
        },
      })
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'discount_code_id' column of 'orders' in the schema cache",
        },
      })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchRichTransactionReviewRows({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mockFetchTransactionReviewRows).toHaveBeenCalledTimes(3);
    const selector = mockFetchTransactionReviewRows.mock.calls[2][0]
      .selectStatement as string;
    expect(selector).not.toContain('variant_attributes');
    expect(selector).not.toContain('discount_code_id');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
  });

  it('keeps cost snapshots when discount codes and unit-cost relations are unavailable together', async () => {
    const rows = [{ id: 'discount-and-unit-cost-fallback-order' }];
    const unitCostSchemaError = {
      code: 'PGRST200',
      message:
        "Could not find a relationship between 'order_items' and 'order_item_unit_costs' in the schema cache",
    };
    const discountCodeSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'discount_code_id' column of 'orders' in the schema cache",
    };
    mockFetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: unitCostSchemaError })
      .mockResolvedValueOnce({ data: null, error: discountCodeSchemaError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchRichTransactionReviewRows({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mockFetchTransactionReviewRows).toHaveBeenCalledTimes(3);
    const selector = mockFetchTransactionReviewRows.mock.calls[2][0]
      .selectStatement as string;
    expect(selector).not.toContain('discount_code_id');
    expect(selector).not.toContain('order_item_unit_costs');
    expect(selector).toContain('cost_price');
    expect(selector).toContain('assurance_fee');
    expect(selector).toContain('product_variants');
  });

  it('carries a missing transaction date into a rich legacy retry', async () => {
    const rows = [{ id: 'transaction-date-and-variant-fallback-order' }];
    mockFetchTransactionReviewRows
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'transaction_date' column of 'orders' in the schema cache",
        },
      })
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'variant_attributes' column of 'order_items' in the schema cache",
        },
      })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchRichTransactionReviewRows({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mockFetchTransactionReviewRows).toHaveBeenCalledTimes(3);
    const [options] = mockFetchTransactionReviewRows.mock.calls[2] ?? [];
    expect(options.includeTransactionDate).toBe(false);
    expect(options.selectStatement).not.toContain('transaction_date');
    expect(options.selectStatement).toContain('order_item_unit_costs');
  });

  it('composes missing variant ids with later rich-field omissions', async () => {
    const rows = [{ id: 'variant-id-and-attributes-fallback-order' }];
    mockFetchTransactionReviewRows
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'variant_id' column of 'order_items' in the schema cache",
        },
      })
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'variant_attributes' column of 'order_items' in the schema cache",
        },
      })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchRichTransactionReviewRows({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mockFetchTransactionReviewRows).toHaveBeenCalledTimes(3);
    const selector = mockFetchTransactionReviewRows.mock.calls[2][0]
      .selectStatement as string;
    expect(selector).not.toContain('variant_id');
    expect(selector).not.toContain('variant_attributes');
    expect(selector).not.toContain('product_variants');
    expect(selector).toContain('order_item_unit_costs');
  });

  it('composes missing line ids with later rich-field omissions', async () => {
    const rows = [{ id: 'line-id-and-attributes-fallback-order' }];
    mockFetchTransactionReviewRows
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'line_id' column of 'order_items' in the schema cache",
        },
      })
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'variant_attributes' column of 'order_items' in the schema cache",
        },
      })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchRichTransactionReviewRows({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mockFetchTransactionReviewRows).toHaveBeenCalledTimes(3);
    const selector = mockFetchTransactionReviewRows.mock.calls[2][0]
      .selectStatement as string;
    expect(selector).not.toContain('line_id');
    expect(selector).not.toContain('variant_attributes');
    expect(selector).toContain('order_item_unit_costs');
  });
});

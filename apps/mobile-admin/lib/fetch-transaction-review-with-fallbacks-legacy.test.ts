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

describe('fetchTransactionReviewWithFallbacks legacy schema fallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps discount provenance when the tax amount column is unavailable', async () => {
    const rows = [{ id: 'tax-column-fallback-order' }];
    const taxAmountSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'tax_amount' column of 'orders' in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: taxAmountSchemaError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(2);
    const selector =
      mocks.fetchTransactionReviewRows.mock.calls[1][0].selectStatement;
    expect(selector).not.toContain('tax_amount');
    expect(selector).toContain('discount_amount');
    expect(selector).toContain('discount_code_id');
    expect(selector).toContain('ad_tracking');
    expect(selector).toContain('order_item_unit_costs');
  });

  it('carries a missing discount amount into a rich legacy retry', async () => {
    const rows = [{ id: 'discount-amount-and-variant-attributes-order' }];
    const discountAmountSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'discount_amount' column of 'orders' in the schema cache",
    };
    const variantAttributesSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'variant_attributes' column of 'order_items' in the schema cache",
    };

    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: discountAmountSchemaError })
      .mockResolvedValueOnce({
        data: null,
        error: variantAttributesSchemaError,
      })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(3);
    const fallbackSelector =
      mocks.fetchTransactionReviewRows.mock.calls[2][0].selectStatement;
    expect(fallbackSelector).not.toContain('discount_amount');
    expect(fallbackSelector).not.toContain('variant_attributes');
    expect(fallbackSelector).toContain('order_item_unit_costs');
  });

  it('keeps cost snapshots when variant attributes and discount codes are unavailable', async () => {
    const rows = [{ id: 'legacy-variant-attributes-order' }];
    const variantAttributesSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'variant_attributes' column of 'order_items' in the schema cache",
    };
    const discountCodeSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'discount_code_id' column of 'orders' in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({
        data: null,
        error: variantAttributesSchemaError,
      })
      .mockResolvedValueOnce({ data: null, error: discountCodeSchemaError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(3);
    const selector =
      mocks.fetchTransactionReviewRows.mock.calls[2][0].selectStatement;
    expect(selector).not.toContain('variant_attributes');
    expect(selector).not.toContain('discount_code_id');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('cost_price');
    expect(selector).toContain('assurance_fee');
    expect(selector).toContain('product_variants');
  });

  it('uses a cost-rich projection when product match status is unavailable', async () => {
    const rows = [{ id: 'legacy-product-match-status-order' }];
    const productMatchStatusSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'product_match_status' column of 'order_items' in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({
        data: null,
        error: productMatchStatusSchemaError,
      })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(2);
    const selector =
      mocks.fetchTransactionReviewRows.mock.calls[1][0].selectStatement;
    expect(selector).not.toContain('product_match_status');
    expect(selector).toContain('assurance_fee');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
  });

  it('uses the final projection without variant_id after schema-cache retries', async () => {
    const rows = [{ id: 'legacy-order' }];
    for (let attempt = 0; attempt < 12; attempt += 1) {
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
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(13);
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[12][0].selectStatement
    ).not.toContain('variant_id');
  });

  it('uses the final projection without quiz award ids when the voucher column is unavailable', async () => {
    const rows = [{ id: 'pre-voucher-migration-order' }];
    const quizAwardIdSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'quiz_award_id' column of 'order_items' in the schema cache",
    };
    for (let attempt = 0; attempt < 14; attempt += 1) {
      mocks.fetchTransactionReviewRows.mockResolvedValueOnce({
        data: null,
        error: quizAwardIdSchemaError,
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
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(15);
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[14][0].selectStatement
    ).not.toContain('quiz_award_id');
  });

  it('composes quiz and line-id omissions in the rich fallback', async () => {
    const rows = [{ id: 'line-and-quiz-fallback-order' }];
    const lineIdSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'line_id' column of 'order_items' in the schema cache",
    };
    const quizAwardIdSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'quiz_award_id' column of 'order_items' in the schema cache",
    };

    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: lineIdSchemaError })
      .mockResolvedValueOnce({ data: null, error: quizAwardIdSchemaError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(3);
    const selector =
      mocks.fetchTransactionReviewRows.mock.calls[2][0].selectStatement;
    expect(selector).not.toContain('line_id');
    expect(selector).not.toContain('quiz_award_id');
    expect(selector).toContain('order_item_unit_costs');
  });

  it('preserves cost relationships when adjustment columns are unavailable', async () => {
    const rows = [{ id: 'legacy-adjustment-order' }];
    const adjustmentSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'vat_rate' column of 'order_items' in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: adjustmentSchemaError })
      .mockResolvedValueOnce({ data: null, error: adjustmentSchemaError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(3);
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[2][0].selectStatement
    ).toContain('order_item_unit_costs');
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[2][0].selectStatement
    ).not.toContain('vat_rate');
  });
});

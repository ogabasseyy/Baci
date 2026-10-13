import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchTransactionReviewRows: vi.fn(),
}));

vi.mock('./fetch-transaction-review-rows', () => ({
  fetchTransactionReviewRows: mocks.fetchTransactionReviewRows,
}));

import { fetchTransactionReviewWithFallbacks } from './fetch-transaction-review-with-fallbacks';
import { TRANSACTION_REVIEW_SELECTORS } from './transaction-review-selectors';

describe('fetchTransactionReviewWithFallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the full projection without retrying when the schema is current', async () => {
    const rows = [{ id: 'order-1' }];
    mocks.fetchTransactionReviewRows.mockResolvedValueOnce({
      data: rows,
      error: null,
    });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(1);
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledWith(
      expect.objectContaining({
        includeCancelledAt: true,
        includeTransactionDate: true,
      })
    );
  });

  it('keeps cancellation filtering on discount-aware base fallbacks', async () => {
    const rows = [{ id: 'legacy-cancellation-filter-order' }];
    const baseWithDiscountNoLineAndVariantId =
      TRANSACTION_REVIEW_SELECTORS.baseWithDiscountNoVariantId.replace(
        ', line_id',
        ''
      );
    const genericSchemaCacheError = {
      code: 'PGRST204',
      message:
        'Could not find a requested order_items field in the schema cache',
    };
    let attempt = 0;
    mocks.fetchTransactionReviewRows.mockImplementation(
      async ({ selectStatement }) => {
        attempt += 1;
        if (attempt === 1) {
          return {
            data: null,
            error: {
              code: 'PGRST204',
              message:
                "Could not find the 'line_id' column of 'order_items' in the schema cache",
            },
          };
        }
        if (selectStatement === baseWithDiscountNoLineAndVariantId) {
          return { data: rows, error: null };
        }
        return { data: null, error: genericSchemaCacheError };
      }
    );

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    const noLineIdCall = mocks.fetchTransactionReviewRows.mock.calls.find(
      ([options]) =>
        options.selectStatement ===
        TRANSACTION_REVIEW_SELECTORS.baseWithDiscountNoLineId
    );
    const noVariantIdCall = mocks.fetchTransactionReviewRows.mock.calls.find(
      ([options]) =>
        options.selectStatement === baseWithDiscountNoLineAndVariantId
    );

    expect(noLineIdCall?.[0]).toEqual(
      expect.objectContaining({ includeCancelledAt: true })
    );
    expect(noVariantIdCall?.[0]).toEqual(
      expect.objectContaining({ includeCancelledAt: true })
    );
  });

  it('uses a cost-rich projection when variant attributes are unavailable', async () => {
    const rows = [{ id: 'legacy-variant-attributes-order' }];
    const variantAttributesSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'variant_attributes' column of 'order_items' in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({
        data: null,
        error: variantAttributesSchemaError,
      })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(2);
    const selector =
      mocks.fetchTransactionReviewRows.mock.calls[1][0].selectStatement;
    expect(selector).not.toContain('variant_attributes');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
  });

  it('uses the full cost-rich projection when discount code ids are unavailable', async () => {
    const rows = [{ id: 'full-discount-code-fallback-order' }];
    const discountCodeSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'discount_code_id' column of 'orders' in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: discountCodeSchemaError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(2);
    const selector =
      mocks.fetchTransactionReviewRows.mock.calls[1][0].selectStatement;
    expect(selector).not.toContain('discount_code_id');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
    expect(selector).toContain('cost_price');
  });

  it('uses a cost-rich projection when variant ids are unavailable', async () => {
    const rows = [{ id: 'full-variant-id-fallback-order' }];
    const variantIdSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'variant_id' column of 'order_items' in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: variantIdSchemaError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(2);
    const selector =
      mocks.fetchTransactionReviewRows.mock.calls[1][0].selectStatement;
    expect(selector).not.toContain('variant_id');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).not.toContain('product_variants');
    expect(selector).toContain('cost_price');
  });

  it('uses a rich projection when quiz award ids are unavailable', async () => {
    const rows = [{ id: 'full-quiz-award-id-fallback-order' }];
    const quizAwardIdSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'quiz_award_id' column of 'order_items' in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: quizAwardIdSchemaError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(2);
    const selector =
      mocks.fetchTransactionReviewRows.mock.calls[1][0].selectStatement;
    expect(selector).not.toContain('quiz_award_id');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
    expect(selector).toContain('cost_price');
  });

  it('keeps quiz award ids excluded across a variant-attributes fallback', async () => {
    const rows = [{ id: 'quiz-and-variant-attributes-fallback-order' }];
    const quizAwardIdSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'quiz_award_id' column of 'order_items' in the schema cache",
    };
    const variantAttributesSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'variant_attributes' column of 'order_items' in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: quizAwardIdSchemaError })
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
    const selector =
      mocks.fetchTransactionReviewRows.mock.calls[2][0].selectStatement;
    expect(selector).not.toContain('quiz_award_id');
    expect(selector).not.toContain('variant_attributes');
    expect(selector).toContain('order_item_unit_costs');
  });

  it('retries a variant-attributes fallback after discovering quiz award ids are missing', async () => {
    const rows = [{ id: 'variant-attributes-and-quiz-fallback-order' }];
    const variantAttributesSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'variant_attributes' column of 'order_items' in the schema cache",
    };
    const quizAwardIdSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'quiz_award_id' column of 'order_items' in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({
        data: null,
        error: variantAttributesSchemaError,
      })
      .mockResolvedValueOnce({ data: null, error: quizAwardIdSchemaError })
      .mockResolvedValueOnce({ data: rows, error: null });

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(3);
    const selector =
      mocks.fetchTransactionReviewRows.mock.calls[2][0].selectStatement;
    expect(selector).not.toContain('quiz_award_id');
    expect(selector).not.toContain('variant_attributes');
    expect(selector).toContain('order_item_unit_costs');
  });

  it('carries variant-attribute drift into base fallbacks after rich fields fail', async () => {
    const rows = [{ id: 'variant-attributes-and-supplier-fallback-order' }];
    const variantAttributesSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'variant_attributes' column of 'order_items' in the schema cache",
    };
    const supplierNameSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'supplier_name' column of 'order_items' in the schema cache",
    };
    mocks.fetchTransactionReviewRows.mockImplementation(
      async ({ selectStatement }) => {
        if (selectStatement === TRANSACTION_REVIEW_SELECTORS.full) {
          return { data: null, error: variantAttributesSchemaError };
        }
        if (selectStatement.includes('supplier_name')) {
          return { data: null, error: supplierNameSchemaError };
        }
        return { data: rows, error: null };
      }
    );

    const result = await fetchTransactionReviewWithFallbacks({
      merchantId: 'merchant-1',
    });

    expect(result).toEqual({ data: rows, error: null });
    const baseFallbackSelector =
      mocks.fetchTransactionReviewRows.mock.calls.at(-1)?.[0].selectStatement;
    expect(baseFallbackSelector).not.toContain('variant_attributes');
    expect(baseFallbackSelector).toContain('ad_tracking');
    expect(baseFallbackSelector).toContain('line_id');
  });
});

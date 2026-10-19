import { describe, expect, it } from 'vitest';
import {
  createTransactionReviewSchemaColumnState,
  omitUnavailableTransactionReviewSchemaColumns,
  type TransactionReviewSchemaColumnAvailability,
} from './transaction-review-fallback-schema-columns';

const noUnavailableColumns: TransactionReviewSchemaColumnAvailability = {
  adTrackingUnavailable: false,
  cancelledAtUnavailable: false,
  discountAmountUnavailable: false,
  discountCodeUnavailable: false,
  lineIdUnavailable: false,
  quizAwardIdUnavailable: false,
  transactionDateUnavailable: false,
  variantIdUnavailable: false,
};

describe('omitUnavailableTransactionReviewSchemaColumns', () => {
  it('tracks each missing column once for fallback retries', () => {
    const state = createTransactionReviewSchemaColumnState();

    expect(state.markMissingSchemaColumn('variant_attributes')).toBe(true);
    expect(state.markMissingSchemaColumn('variant_attributes')).toBe(false);
    expect(state.markMissingSchemaColumn('not_a_column')).toBe(false);
    expect(
      state.getSchemaColumnAvailability().variantAttributesUnavailable
    ).toBe(true);
  });

  it('returns a selector unchanged when every column is available', () => {
    const selector = 'id, discount_amount, ad_tracking';

    expect(
      omitUnavailableTransactionReviewSchemaColumns(
        selector,
        noUnavailableColumns
      )
    ).toBe(selector);
  });

  it('removes only columns known to be unavailable', () => {
    const selector =
      'id, quiz_award_id, quiz_award_amount, discount_code_id, discount_amount, ad_tracking, cancelled_at, transaction_date';

    expect(
      omitUnavailableTransactionReviewSchemaColumns(selector, {
        ...noUnavailableColumns,
        adTrackingUnavailable: true,
        discountAmountUnavailable: true,
        quizAwardAmountUnavailable: true,
        transactionDateUnavailable: true,
      })
    ).toBe('id, quiz_award_id, discount_code_id, cancelled_at');
  });

  it('removes the variant relationship when the variant id is unavailable', () => {
    const selector =
      'id, order_items(id, variant_id, product_variants(cost_price, sku, attributes, condition))';

    expect(
      omitUnavailableTransactionReviewSchemaColumns(selector, {
        ...noUnavailableColumns,
        variantIdUnavailable: true,
      })
    ).toBe('id, order_items(id)');
  });

  it('keeps rich fields while removing a missing line id', () => {
    const selector =
      'id, order_items(id, line_id, variant_id, order_item_unit_costs(unit_index, cost_price))';

    expect(
      omitUnavailableTransactionReviewSchemaColumns(selector, {
        ...noUnavailableColumns,
        lineIdUnavailable: true,
      })
    ).toBe(
      'id, order_items(id, variant_id, order_item_unit_costs(unit_index, cost_price))'
    );
  });

  it('omits rich fields from the tracked unavailable-column set', () => {
    // Arrange
    const selector =
      'id, order_items(id, variant_attributes, product_match_status, order_item_unit_costs(unit_index, cost_price))';
    const unavailableColumns = new Set([
      'order_item_unit_costs',
      'product_match_status',
      'variant_attributes',
    ]);

    // Act
    const result = omitUnavailableTransactionReviewSchemaColumns(
      selector,
      unavailableColumns
    );

    // Assert
    expect(result).toBe('id, order_items(id)');
  });
});

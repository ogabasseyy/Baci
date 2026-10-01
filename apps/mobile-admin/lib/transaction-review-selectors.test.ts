import { describe, expect, it } from 'vitest';
import { TRANSACTION_REVIEW_SELECTORS } from './transaction-review-selectors';

describe('transaction review selectors', () => {
  it('retains discount and tax provenance in the base discount projection', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.baseWithDiscount;

    expect(selector).toContain('discount_amount');
    expect(selector).toContain('discount_code_id');
    expect(selector).toContain('tax_amount');
    expect(selector).toContain('ad_tracking');
    for (const selector of [
      TRANSACTION_REVIEW_SELECTORS.baseWithDiscount,
      TRANSACTION_REVIEW_SELECTORS.baseWithDiscountCompat,
      TRANSACTION_REVIEW_SELECTORS.baseWithDiscountNoLineId,
      TRANSACTION_REVIEW_SELECTORS.baseWithDiscountNoVariantId,
    ]) {
      expect(selector).toContain('assurance_fee');
    }
  });

  it('provides a discount-code-free base projection when that column is unavailable', () => {
    const selector =
      TRANSACTION_REVIEW_SELECTORS.baseWithDiscountNoDiscountCode;

    expect(selector).toContain('discount_amount');
    expect(selector).not.toContain('discount_code_id');
    expect(selector).toContain('tax_amount');
    expect(selector).toContain('ad_tracking');
  });

  it('keeps rich cost snapshots when discount-code metadata is unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.fullNoDiscountCode;

    expect(selector).not.toContain('discount_code_id');
    expect(selector).toContain('tax_amount');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
    expect(selector).toContain('cost_price');
  });

  it('omits the variant relationship when variant ids are unavailable', () => {
    const selectors = [
      TRANSACTION_REVIEW_SELECTORS.fullNoVariantId,
      TRANSACTION_REVIEW_SELECTORS.fullNoVariantIdNoDiscountCode,
      TRANSACTION_REVIEW_SELECTORS.fullNoVariantIdNoDiscount,
      TRANSACTION_REVIEW_SELECTORS.fullNoVariantIdNoDiscountCodeNoDiscount,
    ];

    for (const selector of selectors) {
      expect(selector).not.toContain('variant_id');
      expect(selector).not.toContain('product_variants');
      expect(selector).toContain('order_item_unit_costs');
    }
  });

  it('provides a rich projection when quiz award ids are unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.fullNoQuizAwardId;

    expect(selector).not.toContain('quiz_award_id');
    expect(selector).toContain('variant_id');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
    expect(selector).toContain('cost_price');
  });

  it('keeps the rich discount projection when tax provenance is unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.fullNoTaxAmount;

    expect(selector).not.toContain('tax_amount');
    expect(selector).toContain('discount_amount');
    expect(selector).toContain('discount_code_id');
    expect(selector).toContain('ad_tracking');
    expect(selector).toContain('order_item_unit_costs');
  });

  it('keeps cost snapshots when line ids are unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.fullNoLineId;

    expect(selector).not.toContain('order_items(id, line_id');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
    expect(selector).toContain('cost_price');
  });

  it('keeps cost snapshots when line and variant ids are unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.fullNoLineIdNoVariantId;

    expect(selector).not.toContain('line_id');
    expect(selector).not.toContain('variant_id');
    expect(selector).not.toContain('product_variants');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('cost_price');
  });

  it('keeps cost snapshots when transaction dates are unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.fullNoTransactionDate;

    expect(selector).not.toContain('transaction_date');
    expect(selector).toContain('discount_code_id');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('cost_price');
  });

  it('keeps cost snapshots when cancellation filtering is unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.fullNoCancelledAt;

    expect(selector).not.toContain('cancelled_at');
    expect(selector).toContain('discount_amount');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
  });

  it('keeps discount provenance when ad tracking is unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.fullNoAdTracking;

    expect(selector).not.toContain('ad_tracking');
    expect(selector).toContain('discount_amount');
    expect(selector).toContain('tax_amount');
    expect(selector).toContain('order_item_unit_costs');
  });

  it('keeps cost snapshots when variant ids are unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.fullNoVariantId;

    expect(selector).not.toContain('variant_id');
    expect(selector).toContain('order_items(id, line_id, product_id');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).not.toContain('product_variants');
    expect(selector).toContain('cost_price');
  });

  it('keeps cost snapshots when both discount columns are unavailable', () => {
    const selector =
      TRANSACTION_REVIEW_SELECTORS.fullNoVariantIdNoDiscountCodeNoDiscount;

    expect(selector).not.toContain('variant_id');
    expect(selector).not.toContain('discount_code_id');
    expect(selector).not.toContain('discount_amount');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).not.toContain('product_variants');
    expect(selector).toContain('cost_price');
  });

  it('retains discount provenance in the line-id compatibility selector', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.baseWithDiscountNoLineId;

    expect(selector).toContain('discount_amount');
    expect(selector).toContain('discount_code_id');
    expect(selector).toContain('tax_amount');
    expect(selector).toContain('ad_tracking');
    expect(selector).not.toContain('order_items(id, line_id');
  });

  it('provides a final selector that does not require variant_id', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.baseWithDiscountNoVariantId;

    expect(selector).toContain('discount_amount');
    expect(selector).toContain('discount_code_id');
    expect(selector).toContain('tax_amount');
    expect(selector).toContain('ad_tracking');
    expect(selector).toContain('quiz_award_id');
    expect(selector).toContain('line_id');
    expect(selector).toContain('external_source');
    expect(selector).not.toContain('variant_id');
  });

  it('uses a minimal final selector when optional item columns are unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.noVariantId;

    expect(selector).toContain('discount_amount');
    expect(selector).not.toContain('ad_tracking');
    expect(selector).toContain('quiz_award_id');
    expect(selector).toContain('external_source');
    expect(selector).not.toContain('line_id');
    expect(selector).not.toContain('variant_id');
    expect(selector).not.toContain('variant_attributes');
    expect(selector).not.toContain('condition');
  });

  it('keeps a final selector when quiz award ids are unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.noVariantIdNoQuizAwardId;

    expect(selector).toContain('discount_amount');
    expect(selector).not.toContain('quiz_award_id');
    expect(selector).not.toContain('variant_id');
  });

  it('keeps cost relationships when adjustment columns are unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.legacyNoAdjustments;

    expect(selector).toContain('cost_price');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
    expect(selector).not.toContain('assurance_fee');
    expect(selector).not.toContain('vat_category_code');
    expect(selector).not.toContain('vat_rate');
  });

  it('keeps cost relationships when variant attributes are unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.legacyNoVariantAttributes;

    expect(selector).not.toContain('variant_attributes');
    expect(selector).toContain('variant_id');
    expect(selector).toContain('cost_price');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
  });

  it('keeps unit-cost snapshots when variant attributes and discount codes are unavailable', () => {
    const selector =
      TRANSACTION_REVIEW_SELECTORS.legacyNoVariantAttributesNoDiscountCode;

    expect(selector).not.toContain('variant_attributes');
    expect(selector).not.toContain('discount_code_id');
    expect(selector).toContain('product_match_status');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
  });

  it('keeps unit-cost snapshots when variant attributes and match status are unavailable', () => {
    const selector =
      TRANSACTION_REVIEW_SELECTORS.legacyNoVariantAttributesNoProductMatchStatus;

    expect(selector).not.toContain('variant_attributes');
    expect(selector).not.toContain('product_match_status');
    expect(selector).toContain('discount_code_id');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
  });

  it('composes a rich selector when all three optional fields are unavailable', () => {
    const selector =
      TRANSACTION_REVIEW_SELECTORS.legacyNoVariantAttributesNoProductMatchStatusNoDiscountCode;

    expect(selector).not.toContain('variant_attributes');
    expect(selector).not.toContain('product_match_status');
    expect(selector).not.toContain('discount_code_id');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
  });

  it('omits later schema fields in the older variant compatibility selector', () => {
    const selector =
      TRANSACTION_REVIEW_SELECTORS.legacyNoVariantAttributesNoLaterFields;

    expect(selector).not.toContain('variant_attributes');
    expect(selector).not.toContain('discount_code_id');
    expect(selector).not.toContain('order_item_unit_costs');
    expect(selector).toContain('product_match_status');
    expect(selector).toContain('assurance_fee');
    expect(selector).toContain('product_variants');
  });

  it('only omits unit-cost snapshots in the lossy combined fallback', () => {
    const selector =
      TRANSACTION_REVIEW_SELECTORS.legacyNoVariantAttributesNoProductMatchStatusNoLaterFields;

    expect(selector).not.toContain('variant_attributes');
    expect(selector).not.toContain('product_match_status');
    expect(selector).not.toContain('discount_code_id');
    expect(selector).not.toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
  });

  it('keeps cost relationships when product match status is unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.legacyNoProductMatchStatus;

    expect(selector).not.toContain('product_match_status');
    expect(selector).toContain('variant_attributes');
    expect(selector).toContain('assurance_fee');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
  });

  it('keeps cost relationships when discount code ids are unavailable', () => {
    const selector = TRANSACTION_REVIEW_SELECTORS.legacyNoDiscountCode;

    expect(selector).not.toContain('discount_code_id');
    expect(selector).toContain('cost_price');
    expect(selector).toContain('assurance_fee');
    expect(selector).toContain('vat_category_code');
    expect(selector).toContain('vat_rate');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
  });

  it('keeps a cost fallback when adjustment columns are unavailable too', () => {
    const selector =
      TRANSACTION_REVIEW_SELECTORS.legacyNoAdjustmentsNoDiscountCode;

    expect(selector).not.toContain('discount_code_id');
    expect(selector).toContain('cost_price');
    expect(selector).toContain('order_item_unit_costs');
    expect(selector).toContain('product_variants');
    expect(selector).not.toContain('assurance_fee');
  });
});

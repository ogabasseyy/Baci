import { describe, expect, it } from 'vitest';
import {
  type FullFallbackFlags,
  getFullFallbackProjection,
} from './fetch-transaction-review-full-fallback-projection';

const noUnavailableColumns: FullFallbackFlags = {
  adTrackingUnavailable: false,
  cancelledAtUnavailable: false,
  discountAmountUnavailable: false,
  discountCodeUnavailable: false,
  lineIdUnavailable: false,
  quizAwardIdUnavailable: false,
  quizAwardAmountUnavailable: false,
  transactionDateUnavailable: false,
  variantIdUnavailable: false,
};

describe('getFullFallbackProjection', () => {
  it('keeps cost fields when discount columns are unavailable', () => {
    const projection = getFullFallbackProjection({
      ...noUnavailableColumns,
      discountAmountUnavailable: true,
      discountCodeUnavailable: true,
      variantIdUnavailable: true,
    });

    expect(projection.stage).toBe('FullNoVariantIdNoDiscountCodeNoDiscount');
    expect(projection.selectStatement).not.toContain('discount_amount');
    expect(projection.selectStatement).not.toContain('discount_code_id');
    expect(projection.selectStatement).not.toContain('variant_id');
    expect(projection.selectStatement).toContain('order_item_unit_costs');
  });

  it('composes every known missing column into the projection', () => {
    const projection = getFullFallbackProjection({
      ...noUnavailableColumns,
      adTrackingUnavailable: true,
      cancelledAtUnavailable: true,
      lineIdUnavailable: true,
      quizAwardAmountUnavailable: true,
      quizAwardIdUnavailable: true,
      transactionDateUnavailable: true,
    });

    expect(projection.stage).toBe(
      'FullNoLineIdNoTransactionDateNoQuizAwardIdNoQuizAwardAmountNoAdTrackingNoCancelledAt'
    );
    for (const column of [
      'line_id',
      'transaction_date',
      'quiz_award_id',
      'quiz_award_amount',
      'ad_tracking',
      'cancelled_at',
    ]) {
      expect(projection.selectStatement).not.toContain(column);
    }
  });
});

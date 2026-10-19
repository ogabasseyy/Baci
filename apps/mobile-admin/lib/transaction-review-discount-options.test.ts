import { describe, expect, it } from 'vitest';
import { resolveTransactionReviewDiscountOptions } from './transaction-review-discount-options';

describe('resolveTransactionReviewDiscountOptions', () => {
  it('keeps persisted provenance ahead of legacy and admin fallbacks', () => {
    const persisted = { discountIncludesVat: true };
    const legacy = { discountIncludesVat: false };

    expect(
      resolveTransactionReviewDiscountOptions(persisted, legacy, true)
    ).toBe(persisted);
  });

  it('uses a merchandise-only fallback for an unallocated admin discount', () => {
    expect(
      resolveTransactionReviewDiscountOptions(undefined, undefined, true)
    ).toEqual({
      discountIncludesVat: false,
    });
  });
});

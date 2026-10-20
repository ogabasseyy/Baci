import { describe, expect, it } from 'vitest';
import {
  offerVariantExclusionHolds,
  offerVoucherExclusionHolds,
} from './order-item-offer-aliases';

describe('offerVariantExclusionHolds', () => {
  it('rejects a line naming both a variant and an offer', () => {
    expect(
      offerVariantExclusionHolds({ variantId: 'v1', offer_id: 'o1' })
    ).toBe(false);
    expect(offerVariantExclusionHolds({ offerId: 'o1' })).toBe(true);
    expect(offerVariantExclusionHolds({ variant_id: 'v1' })).toBe(true);
  });
});

describe('offerVoucherExclusionHolds', () => {
  it('rejects an offer line combined with a quiz-voucher redemption', () => {
    expect(
      offerVoucherExclusionHolds({ offerId: 'o1', voucherToken: 'q1' })
    ).toBe(false);
    expect(
      offerVoucherExclusionHolds({ offer_id: 'o1', voucher_award_id: 'q1' })
    ).toBe(false);
    expect(offerVoucherExclusionHolds({ offerId: 'o1' })).toBe(true);
    expect(offerVoucherExclusionHolds({ voucherToken: 'q1' })).toBe(true);
  });
});

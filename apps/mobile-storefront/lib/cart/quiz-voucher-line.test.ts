import { describe, expect, it } from '@jest/globals';
import type { CartItem } from '@/stores/cart-store';
import { isQuizVoucherLine } from './quiz-voucher-line';

const paidItem: CartItem = {
  id: 'line-1',
  name: 'iPhone 15 Pro',
  price: 1_200_000,
  product_id: 'product-1',
  quantity: 1,
  slug: 'iphone-15-pro',
};

describe('isQuizVoucherLine', () => {
  it('detects only complete token-and-award voucher pairs', () => {
    expect(
      isQuizVoucherLine({
        ...paidItem,
        voucher_token: 'qv1.aaa.bbb',
        voucher_award_id: 'award-1',
      })
    ).toBe(true);
    // A partial pair is an ordinary priced line, not voucher-backed.
    expect(
      isQuizVoucherLine({ ...paidItem, voucher_token: 'qv1.aaa.bbb' })
    ).toBe(false);
    expect(
      isQuizVoucherLine({ ...paidItem, voucher_award_id: 'award-1' })
    ).toBe(false);
  });

  it('returns false for normal paid cart lines', () => {
    expect(isQuizVoucherLine(paidItem)).toBe(false);
  });
});

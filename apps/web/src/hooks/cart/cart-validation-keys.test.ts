import { describe, expect, it } from 'vitest';
import {
  getBaseLineValidationKey,
  isQuizVoucherLine,
} from './cart-validation-keys';

describe('cart-validation-keys', () => {
  it('builds a base-line-scoped key distinct from the bare product id', () => {
    expect(getBaseLineValidationKey('product-1')).toBe('product-1::base');
    expect(getBaseLineValidationKey('product-1')).not.toBe('product-1');
  });

  it('detects voucher lines from either proof field', () => {
    expect(isQuizVoucherLine({ quizAwardId: 'award-1' })).toBe(true);
    expect(isQuizVoucherLine({ quizVoucherToken: 'tok-1' })).toBe(true);
    expect(isQuizVoucherLine({})).toBe(false);
    expect(
      isQuizVoucherLine({ quizAwardId: null, quizVoucherToken: null })
    ).toBe(false);
  });
});

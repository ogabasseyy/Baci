import type { CartItem } from '@/stores/cart-store';
import { isPrizeOnlyCheckout } from './checkout-prize-display';

const paidLine: CartItem = {
  id: 'paid-1',
  name: 'Phone case',
  price: 5000,
  product_id: 'product-2',
  quantity: 1,
  slug: 'phone-case',
};

const prizeLine: CartItem = {
  ...paidLine,
  id: 'prize-1',
  name: 'iPhone XR',
  price: 0,
  voucher_award_id: 'award-1',
  voucher_token: 'token-1',
};

describe('isPrizeOnlyCheckout', () => {
  it('is true when every line is a quiz prize', () => {
    expect(isPrizeOnlyCheckout([prizeLine])).toBe(true);
  });

  it('is false for an ordinary paid cart', () => {
    expect(isPrizeOnlyCheckout([paidLine])).toBe(false);
  });

  it('is false when a prize is mixed with a paid line', () => {
    expect(isPrizeOnlyCheckout([prizeLine, paidLine])).toBe(false);
  });

  it('is false for a line with only half of the voucher pair', () => {
    expect(
      isPrizeOnlyCheckout([{ ...prizeLine, voucher_award_id: undefined }])
    ).toBe(false);
  });

  it('is false for an empty cart', () => {
    expect(isPrizeOnlyCheckout([])).toBe(false);
  });
});

import type { CartItem } from '@/stores/cart-store';
import { isSettledPrizeOrder } from './is-settled-prize-order';

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
  price: 0,
  voucher_award_id: 'award-1',
  voucher_token: 'token-1',
};

describe('isSettledPrizeOrder', () => {
  it('is true for a paid prize order with nothing due', () => {
    expect(
      isSettledPrizeOrder({
        amountDueToGateway: 0,
        itemsSnapshot: [prizeLine],
        paymentStatus: 'paid',
      })
    ).toBe(true);
    expect(
      isSettledPrizeOrder({
        amountDueToGateway: undefined,
        itemsSnapshot: [prizeLine],
        paymentStatus: 'paid',
      })
    ).toBe(true);
  });

  it('is false while a prize order is unpaid or still owes money', () => {
    expect(
      isSettledPrizeOrder({
        amountDueToGateway: 0,
        itemsSnapshot: [prizeLine],
        paymentStatus: 'pending',
      })
    ).toBe(false);
    expect(
      isSettledPrizeOrder({
        amountDueToGateway: 3500,
        itemsSnapshot: [prizeLine],
        paymentStatus: 'paid',
      })
    ).toBe(false);
  });

  it('is false for an ordinary order, even a fully paid one', () => {
    expect(
      isSettledPrizeOrder({
        amountDueToGateway: 0,
        itemsSnapshot: [paidLine],
        paymentStatus: 'paid',
      })
    ).toBe(false);
    expect(
      isSettledPrizeOrder({
        amountDueToGateway: 0,
        itemsSnapshot: undefined,
        paymentStatus: 'paid',
      })
    ).toBe(false);
  });
});

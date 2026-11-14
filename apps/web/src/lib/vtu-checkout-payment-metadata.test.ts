import { describe, expect, it, vi } from 'vitest';
import { checkoutPaymentMetadata } from './vtu-checkout-payment-metadata';

vi.mock('server-only', () => ({}));

describe('checkoutPaymentMetadata', () => {
  it('writes the wallet split for a store credit checkout', () => {
    expect(
      checkoutPaymentMetadata({
        source: 'checkout',
        walletAmount: 500,
        purchaseAmount: 500,
      })
    ).toEqual({ paymentSplit: { wallet: 500, card: 0 } });
  });

  it('marks a PiggyVest wallet checkout and keeps its wallet split', () => {
    expect(
      checkoutPaymentMetadata({
        source: 'checkout',
        paymentMethod: 'piggyvest_wallet',
        walletAmount: 500,
        purchaseAmount: 500,
      })
    ).toEqual({
      paymentSource: 'piggyvest_wallet',
      paymentSplit: { wallet: 500, card: 0 },
    });
  });

  it('writes nothing for non-checkout sources or no wallet amount', () => {
    expect(
      checkoutPaymentMetadata({
        source: 'gift',
        paymentMethod: 'piggyvest_wallet',
        walletAmount: 500,
        purchaseAmount: 500,
      })
    ).toEqual({});
    expect(
      checkoutPaymentMetadata({ source: 'checkout', purchaseAmount: 500 })
    ).toEqual({});
  });
});

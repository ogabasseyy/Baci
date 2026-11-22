import { expect, it } from 'vitest';
import { findBrowserBankOfferRecovery } from './find-browser-bank-offer-recovery';

const attempt = {
  orderId: 'order',
  trackingToken: 'track',
  merchantId: 'merchant',
  customerEmail: 'buyer@example.com',
  customerPhone: '',
  checkoutFingerprint: 'bank-card-offer:campaign:9500:cart',
  paymentMethod: 'bank_card_offer',
  amountDueToGateway: 95,
  createdAt: '2026-11-20',
};

it('only offers recovery in the signed-in shopper and merchant scope', () => {
  expect(
    findBrowserBankOfferRecovery(
      attempt,
      'merchant',
      ' BUYER@example.com ',
      true
    )
  ).toBe(attempt);
  expect(
    findBrowserBankOfferRecovery(attempt, 'other', 'buyer@example.com', true)
  ).toBeNull();
  expect(
    findBrowserBankOfferRecovery(attempt, 'merchant', 'other@example.com', true)
  ).toBeNull();
  expect(
    findBrowserBankOfferRecovery(
      attempt,
      'merchant',
      'buyer@example.com',
      false
    )
  ).toBeNull();
});

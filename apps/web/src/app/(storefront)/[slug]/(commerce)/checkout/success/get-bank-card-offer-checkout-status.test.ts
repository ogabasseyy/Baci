import { expect, it } from 'vitest';
import { getBankCardOfferCheckoutStatus } from './get-bank-card-offer-checkout-status';

it('distinguishes ownership denials from persistent CSRF failures', () => {
  expect(
    getBankCardOfferCheckoutStatus(403, {
      code: 'BANK_CARD_OFFER_VERIFICATION_DENIED',
    })
  ).toBe('access_required');
  expect(getBankCardOfferCheckoutStatus(403, {})).toBe(
    'verification_unavailable'
  );
});

it.each([
  'failed',
  'cancelled',
  'abandoned',
] as const)('keeps a %s payment in review', (status) => {
  expect(getBankCardOfferCheckoutStatus(200, { status })).toBe(
    'bank_offer_review'
  );
});

it('identifies a reversal only on a successful terminal response', () => {
  expect(getBankCardOfferCheckoutStatus(200, { status: 'reversed' })).toBe(
    'reversed'
  );
  expect(
    getBankCardOfferCheckoutStatus(202, { status: 'reversed' })
  ).toBeNull();
  expect(getBankCardOfferCheckoutStatus(500, { status: 'reversed' })).toBe(
    'pending'
  );
  expect(getBankCardOfferCheckoutStatus(200, { status: 'success' })).toBeNull();
});

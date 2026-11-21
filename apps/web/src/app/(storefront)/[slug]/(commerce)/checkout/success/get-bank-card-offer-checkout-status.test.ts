import { expect, it } from 'vitest';
import { getBankCardOfferCheckoutStatus } from './get-bank-card-offer-checkout-status';

it.each([
  401, 403,
])('requires the explicit ownership denial code for HTTP %s', (status) => {
  expect(
    getBankCardOfferCheckoutStatus(status, {
      code: 'BANK_CARD_OFFER_VERIFICATION_DENIED',
    })
  ).toBe('access_required');
  expect(getBankCardOfferCheckoutStatus(status, {})).toBe(
    'verification_unavailable'
  );
});

it('recognizes a recorded capture review in a pending HTTP envelope', () => {
  expect(
    getBankCardOfferCheckoutStatus(202, {
      status: 'pending',
      code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
    })
  ).toBe('bank_offer_review');
});

it.each([
  'failed',
  'cancelled',
  'abandoned',
] as const)('keeps a %s payment in review', (status) => {
  expect(getBankCardOfferCheckoutStatus(200, { status })).toBe(
    'bank_offer_review'
  );
  expect(getBankCardOfferCheckoutStatus(202, { status })).toBe(
    'bank_offer_review'
  );
});

it('identifies a reversal only on a successful terminal response', () => {
  expect(getBankCardOfferCheckoutStatus(200, { status: 'reversed' })).toBe(
    'reversed'
  );
  expect(getBankCardOfferCheckoutStatus(202, { status: 'reversed' })).toBe(
    'reversed'
  );
  expect(getBankCardOfferCheckoutStatus(202, { status: 'pending' })).toBeNull();
  expect(getBankCardOfferCheckoutStatus(500, { status: 'reversed' })).toBe(
    'verification_unavailable'
  );
  expect(getBankCardOfferCheckoutStatus(200, { status: 'success' })).toBeNull();
});

it.each([
  408, 429, 502, 503, 504,
])('keeps a bank offer pending on HTTP %s', (status) => {
  expect(getBankCardOfferCheckoutStatus(status, {})).toBe('pending');
});

it.each([
  400, 404, 409, 422, 500, 501, 505,
])('keeps HTTP %s out of the payment failure path', (status) => {
  expect(getBankCardOfferCheckoutStatus(status, {})).toBe(
    'verification_unavailable'
  );
});

it('treats a missing reference as unavailable and reserves review for a known mismatch', () => {
  expect(
    getBankCardOfferCheckoutStatus(404, { code: 'reference_not_found' })
  ).toBe('verification_unavailable');
  expect(
    getBankCardOfferCheckoutStatus(409, { code: 'reference_not_order_payment' })
  ).toBe('bank_offer_review');
});

import { expect, it, vi } from 'vitest';
import {
  bankCardOfferRetryDelay,
  getBankCardOfferCheckoutStatus,
} from './get-bank-card-offer-checkout-status';

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
    'pending'
  );
  expect(getBankCardOfferCheckoutStatus(200, { status: 'success' })).toBeNull();
});

it.each([408, 429, 503])('keeps a bank offer pending on HTTP %s', (status) => {
  expect(getBankCardOfferCheckoutStatus(status, {})).toBe('pending');
});

it.each([
  ['45', 45000],
  ['bad', 15_000],
  ['0', 15_000],
  ['1000000000', 300_000],
])('reads a bounded Retry-After of %s', (retryAfter, delay) => {
  const response = new Response(null, {
    status: 429,
    headers: { 'Retry-After': retryAfter },
  });
  expect(bankCardOfferRetryDelay(response)).toBe(delay);
});

it('backs off when rate limited without a Retry-After header', () => {
  expect(bankCardOfferRetryDelay(new Response(null, { status: 429 }))).toBe(
    15_000
  );
});

it('honors an HTTP-date Retry-After', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
    const response = new Response(null, {
      status: 429,
      headers: { 'Retry-After': 'Fri, 20 Nov 2026 12:01:00 GMT' },
    });
    expect(bankCardOfferRetryDelay(response)).toBe(60_000);
    response.headers.set('Retry-After', 'Fri, 20 Nov 2026 11:59:00 GMT');
    expect(bankCardOfferRetryDelay(response)).toBe(15_000);
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  400, 404, 409, 422,
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

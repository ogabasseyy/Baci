import type { VerificationResponse } from './verify-checkout-payment-response';

export function getBankCardOfferCheckoutStatus(
  httpStatus: number,
  payment: VerificationResponse
) {
  // fetchWithCsrf has already retried a recognized CSRF failure.
  if (httpStatus === 403) {
    return payment.code === 'BANK_CARD_OFFER_VERIFICATION_DENIED'
      ? 'access_required'
      : 'verification_unavailable';
  }
  if (httpStatus < 200 || httpStatus >= 300 || httpStatus === 202) return null;

  if (payment.status === 'reversed') return 'reversed';
  if (
    payment.status === 'failed' ||
    payment.status === 'cancelled' ||
    payment.status === 'abandoned'
  )
    return 'bank_offer_review';

  return null;
}

import { isCapturedPaymentFinalizationOutcome } from './captured-payment-finalization-outcomes';
import type { VerificationResponse } from './verify-checkout-payment-response';

export function getBankCardOfferCheckoutStatus(
  httpStatus: number,
  payment: VerificationResponse
) {
  // fetchWithCsrf has already retried a recognized CSRF failure.
  // A bare 401 or 403 can also come from middleware. Only an explicit
  // bank-offer ownership denial should send the shopper to sign in.
  if (httpStatus === 401 || httpStatus === 403) {
    return payment.code === 'BANK_CARD_OFFER_VERIFICATION_DENIED'
      ? 'access_required'
      : 'verification_unavailable';
  }
  if (
    httpStatus >= 400 &&
    isCapturedPaymentFinalizationOutcome(payment.finalizationOutcome)
  )
    return 'pending';

  // A proxy or server failure can carry invalid or stale data. Only a
  // successful verification response can establish a terminal outcome.
  if ([408, 429, 502, 503, 504].includes(httpStatus)) return 'pending';
  if (httpStatus === 409 && payment.code === 'reference_not_order_payment')
    return 'bank_offer_review';
  if (httpStatus < 200 || httpStatus >= 300) return 'verification_unavailable';
  if (payment.code === 'BANK_CARD_OFFER_CAPTURE_REVIEW') {
    return 'bank_offer_review';
  }
  if (payment.status === 'reversed') return 'reversed';
  if (
    payment.status === 'failed' ||
    payment.status === 'cancelled' ||
    payment.status === 'abandoned'
  )
    return 'bank_offer_review';

  return null;
}

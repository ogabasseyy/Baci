import type { VerificationResponse } from './verify-checkout-payment-response';

export function getBankCardOfferCheckoutStatus(
  httpStatus: number,
  payment: VerificationResponse
) {
  // fetchWithCsrf has already retried a recognized CSRF failure.
  if (httpStatus === 401) return 'access_required';
  if (httpStatus === 403) {
    return payment.code === 'BANK_CARD_OFFER_VERIFICATION_DENIED'
      ? 'access_required'
      : 'verification_unavailable';
  }
  // Transient responses leave the capture unknown. Keep polling this reference.
  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500)
    return 'pending';
  if (
    (httpStatus === 404 && payment.code === 'reference_not_found') ||
    (httpStatus === 409 && payment.code === 'reference_not_order_payment')
  )
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

const DEFAULT_RETRY_AFTER_MS = 15_000;
const MAX_RETRY_AFTER_MS = 5 * 60_000;

export function bankCardOfferRetryDelay(response: Response): number {
  if (response.status !== 429 && response.status !== 503) return 0;
  const retryAfter = response.headers.get('Retry-After')?.trim();
  if (!retryAfter) return DEFAULT_RETRY_AFTER_MS;
  const delay = /^\d+$/.test(retryAfter)
    ? Number(retryAfter) * 1000
    : Date.parse(retryAfter) - Date.now();
  return delay > 0
    ? Math.min(MAX_RETRY_AFTER_MS, delay)
    : DEFAULT_RETRY_AFTER_MS;
}

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
  // Transient responses leave the capture unknown. Keep polling this reference.
  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500)
    return 'pending';
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

const MAX_RETRY_AFTER_MS = 5 * 60_000;

export function bankCardOfferRetryDelay(response: Response): number {
  if (response.status !== 429) return 0;
  const retryAfter = response.headers.get('Retry-After')?.trim();
  if (!retryAfter) return 0;
  const delay = /^\d+$/.test(retryAfter)
    ? Number(retryAfter) * 1000
    : Date.parse(retryAfter) - Date.now();
  return Number.isNaN(delay)
    ? 0
    : Math.min(MAX_RETRY_AFTER_MS, Math.max(0, delay));
}

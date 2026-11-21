import { bankCardOfferRetryDelay } from './bank-card-offer-retry-delay';
import { getBankCardOfferCheckoutStatus } from './get-bank-card-offer-checkout-status';
import type { VerifyCheckoutPaymentHandlers } from './verify-checkout-payment';
import {
  isAbortError,
  isVerificationResponse,
} from './verify-checkout-payment-response';

export async function readBankCardOfferCheckoutResponse(
  response: Response,
  {
    setOrderNumber,
    setStatus,
  }: Pick<VerifyCheckoutPaymentHandlers, 'setOrderNumber' | 'setStatus'>,
  expectedOrderId?: string | null
) {
  const raw: unknown = await response.json().catch((error: unknown) => {
    if (!isAbortError(error)) {
      console.warn('Bank card offer verification returned invalid JSON', {
        status: response.status,
      });
    }
    return null;
  });
  const data = isVerificationResponse(raw) ? raw : {};
  if (
    response.status === 200 &&
    expectedOrderId &&
    data.orderId !== expectedOrderId
  ) {
    setOrderNumber(null);
    setStatus('verification_unavailable');
    return { handled: true as const };
  }
  const status = getBankCardOfferCheckoutStatus(response.status, data);
  if (!status) return { handled: false as const, data };

  const retryDelay = status === 'pending' && bankCardOfferRetryDelay(response);
  if (retryDelay) setStatus(status, retryDelay);
  else setStatus(status);
  // A pending poll can keep the last verified number for this identity.
  if (response.ok && data.orderNumber) setOrderNumber(data.orderNumber);
  else if (
    status !== 'pending' ||
    response.status === 401 ||
    response.status === 403
  )
    setOrderNumber(null);
  return { handled: true as const };
}

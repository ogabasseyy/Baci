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
  }: Pick<VerifyCheckoutPaymentHandlers, 'setOrderNumber' | 'setStatus'>
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
  const status = getBankCardOfferCheckoutStatus(response.status, data);
  if (!status) return { handled: false as const, data };

  const retryDelay = status === 'pending' && bankCardOfferRetryDelay(response);
  if (retryDelay) setStatus(status, retryDelay);
  else setStatus(status);
  // An ownership denial clears an already verified order number.
  if (status === 'access_required') setOrderNumber(null);
  else if (response.ok && data.orderNumber) setOrderNumber(data.orderNumber);
  return { handled: true as const };
}

import type { PaymentMethod } from './types';

/**
 * Normalizes checkout payment methods to the persisted order values used for
 * pending-order reuse. Card-backed gateways (`paystack`, `korapay`) are stored
 * as `card`, methods with distinct downstream handling are persisted as-is, and
 * anything else falls back to `pod` for pay-on-delivery compatibility.
 */
export function normalizeOrderPaymentMethod(
  paymentMethod: PaymentMethod
): string {
  if (paymentMethod === 'paystack' || paymentMethod === 'korapay') {
    return 'card';
  }

  if (
    paymentMethod === 'uba_redvault' ||
    paymentMethod === 'oxygen' ||
    paymentMethod === 'klump' ||
    paymentMethod === 'credit_direct' ||
    paymentMethod === 'credpal' ||
    paymentMethod === 'invoice' ||
    paymentMethod === 'juicyway' ||
    paymentMethod === 'bank_transfer' ||
    paymentMethod === 'payforme' ||
    paymentMethod === 'paypal'
  ) {
    return paymentMethod;
  }

  return 'pod';
}

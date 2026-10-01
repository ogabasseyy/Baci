import type { CreditDirectPopupMarker } from '../credit-direct-popup-return';

export interface CreditDirectVerificationHandoff {
  orderId: string;
  merchantSlug: string;
  completionMarker?: CreditDirectPopupMarker | null;
  trackingToken?: string | null;
  customerEmail?: string | null;
}

export function buildCreditDirectVerificationPath({
  orderId,
  merchantSlug,
  completionMarker,
  trackingToken,
  customerEmail,
}: CreditDirectVerificationHandoff): string {
  const query = new URLSearchParams({
    orderId,
    gateway: 'credit_direct',
    merchant_slug: merchantSlug,
  });
  if (completionMarker) {
    query.set('creditDirectCompletion', completionMarker.transactionId);
  }
  if (trackingToken) query.set('trackingToken', trackingToken);
  if (customerEmail) query.set('email', customerEmail);
  return `/checkout/bnpl?${query.toString()}`;
}

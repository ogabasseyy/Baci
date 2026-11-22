import type { PendingCheckoutOrderSnapshot } from './pending-checkout-order';

export function findBrowserBankOfferRecovery(
  pending: PendingCheckoutOrderSnapshot | null,
  merchantId: string | undefined,
  customerEmail: string,
  available: boolean
): PendingCheckoutOrderSnapshot | null {
  return available &&
    pending?.paymentMethod === 'bank_card_offer' &&
    pending.merchantId === merchantId &&
    pending.customerEmail.trim().toLowerCase() ===
      customerEmail.trim().toLowerCase() &&
    /^bank-card-offer:[^:]+:[0-9]+:/.test(pending.checkoutFingerprint) &&
    Number.isFinite(pending.amountDueToGateway) &&
    pending.amountDueToGateway > 0
    ? pending
    : null;
}

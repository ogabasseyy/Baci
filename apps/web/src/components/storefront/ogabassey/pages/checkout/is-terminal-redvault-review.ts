import type { PendingCheckoutOrderSnapshot } from './pending-checkout-order';
import { readRedvaultReviewRecovery } from './read-redvault-review-recovery';

/** A completed cart's validated local review may continue or be cancelled. */
export function isTerminalRedvaultReview({
  merchantId,
  pendingOrder,
  sharedCartEnabled,
  sharedCartRef,
  checkoutItemCount,
}: {
  merchantId: string | undefined;
  pendingOrder: PendingCheckoutOrderSnapshot | null;
  sharedCartEnabled: boolean | undefined;
  sharedCartRef: { cartId: string; version: number } | null | undefined;
  checkoutItemCount: number;
}): boolean {
  const recovery = readRedvaultReviewRecovery(pendingOrder, merchantId);
  return Boolean(
    sharedCartEnabled &&
      checkoutItemCount === 0 &&
      recovery &&
      (!sharedCartRef || recovery.ready.cartId)
  );
}

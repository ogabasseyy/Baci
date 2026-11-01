import { peekCartCookieEpoch } from '@/hooks/cart/cart-cross-tab-lock';
import { isCartSessionRetiring } from '@/hooks/cart/cart-session-write-fence';
import { redvaultReviewRecoverySchema } from '@/schemas/redvault-review-recovery';
import type { PendingCheckoutOrderSnapshot } from './pending-checkout-order';

/** Browser storage restores presentation only; payment still verifies the order on the server. */
export function readRedvaultReviewRecovery(
  pending: PendingCheckoutOrderSnapshot | null,
  merchantId: string | undefined
) {
  if (
    !pending ||
    !merchantId ||
    pending.merchantId !== merchantId ||
    pending.paymentMethod !== 'uba_redvault'
  )
    return null;
  const parsed = redvaultReviewRecoverySchema.safeParse(pending.redvaultReview);
  if (!parsed.success) return null;
  const { ready, summary } = parsed.data;
  const fence = parsed.data.recoveryFence;
  if (
    fence &&
    (isCartSessionRetiring(fence.merchantSlug) ||
      peekCartCookieEpoch(fence.merchantSlug) === undefined ||
      peekCartCookieEpoch(fence.merchantSlug) !== fence.epoch)
  )
    return null;
  if (
    ready.orderId !== pending.orderId ||
    ready.trackingToken !== pending.trackingToken ||
    ready.customerEmail !== pending.customerEmail ||
    ready.customerPhone !== pending.customerPhone ||
    ready.checkoutFingerprint !== pending.checkoutFingerprint ||
    Math.round(ready.total * 100) !== summary.payableKobo ||
    Math.round(pending.amountDueToGateway * 100) !== summary.payableKobo
  )
    return null;
  try {
    const fingerprint: unknown = JSON.parse(
      ready.checkoutFingerprint.slice('uba_redvault:'.length)
    );
    if (
      !fingerprint ||
      typeof fingerprint !== 'object' ||
      Array.isArray(fingerprint)
    )
      return null;
    const fields = fingerprint as Record<string, unknown>;
    if (
      fields.merchantId !== merchantId ||
      fields.customerEmail !== ready.customerEmail.trim().toLowerCase() ||
      !Array.isArray(fields.items) ||
      fields.items.length === 0
    )
      return null;
  } catch {
    return null;
  }
  return parsed.data;
}

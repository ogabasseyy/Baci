import { releaseCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-release';
import {
  awaitCreationPurchaseEmission,
  claimCheckoutPurchaseTracking,
  isCheckoutPurchaseClaimedSettled,
  markCheckoutPurchaseEmitted,
} from '@/lib/claim-checkout-purchase-tracking';
import { createLogger } from '@/lib/logger';
import { useCartStore } from '@/stores/cart-store';
import { serializeAfterOrderCreated } from './serialize-after-order-created';
import {
  type CheckoutTrackingItem,
  trackCheckoutRoutePurchaseCompleted,
} from './tiktok-checkout-route-tracking';
import { trackCheckoutPaymentCompleted } from './track-checkout-payment-completed';

const log = createLogger('CheckoutTracking');

export interface CheckoutCompletionAttribution {
  // Checkout identity snapshot for guest purchase matching (the cached
  // auth identity is empty for guests, so the server conversion would
  // otherwise receive blank email/phone/external id).
  customerEmail?: string;
  customerPhone?: string;
  userId?: string;
  // Snapshot callers whose cart may clear before the deferred completion
  // runs pass items synchronously so the purchase keeps its lines. Cart
  // items satisfy this shape; tracked-order lines are mapped to it.
  items?: CheckoutTrackingItem[];
  // Canonical order breakdown. Callers that know only the grand total omit
  // these and the purchase keeps total with zero shipping/tax; callers with
  // the snapshot/track-order breakdown must pass it so analytics dimensions
  // are not corrupted.
  subtotal?: number;
  shipping?: number;
  tax?: number;
  /**
   * Stamped order currency: forwarded to the funnel payment_completed
   * (via the shared event builder) and the ad/legacy purchase so a
   * non-NGN attempt keeps one currency on every stage. Absent values
   * keep the NGN default.
   */
  currency?: string;
}

type CheckoutPaymentCompletionInput = CheckoutCompletionAttribution & {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reference?: string;
  value?: number;
};

// Shared with the REDVAULT completion path, which emits the funnel event
// directly (the once-helper would re-emit the ad purchase the REDVAULT
// branch already owns): both lanes must claim the same key.
export const PAYMENT_COMPLETED_CLAIM_EVENT = 'payment_completed';

// Outcome of a completion attempt. Settlement polling must distinguish a
// released claim (the order is still paid but nothing was recorded: keep
// polling) from an already-recorded conversion (another path emitted it:
// stop), which a bare boolean cannot express.
export type CheckoutPaymentCompletionOutcome =
  | 'emitted'
  | 'already_emitted'
  | 'released';

// Records the paid conversion once per order. The first caller wins the
// durable claim and emits both the funnel payment_completed event and the
// native ad purchase; replays after a remount, recovery, or reopened intent
// report already_emitted and emit nothing, while navigation still proceeds.
export async function trackCheckoutPaymentCompletedOnce(
  input: CheckoutPaymentCompletionInput
): Promise<CheckoutPaymentCompletionOutcome> {
  // Wait behind the order-created emission for this order so the funnel
  // keeps causal order even though creation is recorded fire-and-forget.
  return await serializeAfterOrderCreated(input.orderId, async () => {
    const claimed = await claimCheckoutPurchaseTracking(
      input.orderId,
      PAYMENT_COMPLETED_CLAIM_EVENT
    );
    if (!claimed) {
      // A denied claim usually means another path already recorded the
      // conversion — but it can also mean the store was unreadable and
      // nothing was granted. Check which through the serialized chain: a
      // raw read could catch a timed-out write's phantom claim before its
      // rollback lands and stop polling although nothing was recorded.
      // Polling callers must keep their lane when nothing is recorded,
      // yet stop when the conversion is already safe.
      const held = await isCheckoutPurchaseClaimedSettled(
        input.orderId,
        PAYMENT_COMPLETED_CLAIM_EVENT
      );
      return held ? 'already_emitted' : 'released';
    }
    // The checkout finalization already emits the ad purchase under the
    // default purchase claim right after order creation: repeating it
    // here would double-count every normally settled order, so the
    // completion lane emits the funnel event only when that purchase
    // already went out. The bare claim reads held from the instant it is
    // granted while the fire-and-forget creation emission may still be
    // running — share that in-flight emission instead of trusting the
    // claim, or a later rejection loses the purchase while the funnel
    // event emitted here stands. A failed creation releases its claim,
    // so the completion emits the purchase itself below.
    const creationOutcome = await awaitCreationPurchaseEmission(input.orderId);
    const purchaseAlreadySent =
      creationOutcome === 'sent'
        ? true
        : creationOutcome === 'failed'
          ? false
          : await isCheckoutPurchaseClaimedSettled(input.orderId);
    const total = input.value ?? 0;
    if (!purchaseAlreadySent) {
      try {
        // Awaited (not discarded): if the ad purchase rejects — e.g.
        // generateEventId fails on Expo Crypto — the claim rolls back so a
        // later settlement poll or revisit can emit, instead of suppressing
        // the conversion forever behind an unhandled rejection.
        await trackCheckoutRoutePurchaseCompleted({
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          items: input.items ?? useCartStore.getState().items,
          orderId: input.orderId,
          orderNumber: input.orderNumber || input.orderId,
          paymentMethod: input.paymentMethod,
          shipping: input.shipping ?? 0,
          subtotal: input.subtotal ?? total,
          tax: input.tax ?? 0,
          total,
          ...(input.currency ? { currency: input.currency } : {}),
          userId: input.userId,
        });
      } catch (error) {
        log.error('Checkout purchase tracking failed; claim released:', error);
        await releaseCheckoutPurchaseTracking(
          input.orderId,
          PAYMENT_COMPLETED_CLAIM_EVENT
        );
        return 'released';
      }
    }
    // After the fallible emission succeeds: a rolled-back attempt must
    // not leave a funnel payment_completed behind, or its retry would
    // double-count the conversion.
    trackCheckoutPaymentCompleted(input);
    // Emission proof for crash recovery: a restart after this point reads
    // the claim as recorded at any age. Without it, a crash between grant
    // and dispatch would orphan the claim and a later poll could
    // double-emit; with it, only never-dispatched (unmarked) aged claims
    // are recoverable.
    await markCheckoutPurchaseEmitted(
      input.orderId,
      PAYMENT_COMPLETED_CLAIM_EVENT
    );
    return 'emitted';
  });
}

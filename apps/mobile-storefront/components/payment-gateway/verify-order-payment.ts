import type { TrackedCompletionAttribution } from '@/lib/tracked-order-completion';
import { checkReferenceSettled } from './verify-order-payment-reference-settlement';
import {
  checkTrackedOrderPaid,
  type TrackedOrderVerification,
} from './verify-order-payment-tracked-lookup';

interface VerifyOrderPaymentInput {
  orderId?: string;
  trackingToken?: string;
  reference?: string;
}

export interface OrderPaymentVerification extends TrackedCompletionAttribution {
  paid: boolean;
  /**
   * Definitive gateway outcome for this order: the verify endpoint
   * confirmed the reference cannot settle. Present only alongside
   * `paid: false` — and only when the envelope carries this order's
   * identity, so a foreign failure can never fail this order. Callers
   * use it to keep the error/retry path instead of navigating to
   * success; its absence means transient (pending/network) and keeps
   * the settlement-polling success navigation. `abandoned` is terminal
   * too: Paystack reports it when the shopper leaves the payment page,
   * and the attempt can never settle afterwards.
   */
  terminalFailure?: 'failed' | 'cancelled' | 'abandoned';
  /**
   * Captured-but-unresolved outcome for this order: the provider took
   * the money but the finalizer left no active paid order (a
   * reconciliation review was filed, or the order was refunded after
   * capture). Present only alongside `paid: false` with this order's
   * identity. Callers route it to the reconciliation state — never the
   * generic confirmation — and skip settlement polling, which can never
   * make such an order paid. Ordinary cancelled rows (no proven
   * capture) use `terminalFailure` instead.
   */
  reconciliation?: 'order_cancelled' | 'order_skipped';
  /**
   * Transport/parse failure (not a verified unpaid row): callers that
   * must not treat absence-of-proof as proof-of-absence — the
   * order-success reconciliation-param check — stay pending on this
   * instead of coercing to false. The gateway completion flow ignores
   * it: `{paid:false}` without a terminal outcome stays transient and
   * keeps settlement polling, exactly as before.
   */
  inconclusive?: boolean;
}

// Guards WebView completion callbacks: a completion-looking redirect (or a
// URL carrying the expected reference) proves association with the order,
// not settlement — a pending or spoofed navigation must not record a paid
// conversion. Read-only order lookup first; reference verification (which
// may finalize server-side) only when the lookup does not confirm paid.
export async function verifyOrderPaymentForCompletion({
  orderId,
  trackingToken,
  reference,
}: VerifyOrderPaymentInput): Promise<OrderPaymentVerification> {
  if (!orderId) {
    return { paid: false };
  }
  let pendingAttribution: TrackedCompletionAttribution | undefined;
  let inconclusive = false;
  if (trackingToken) {
    const tracked: TrackedOrderVerification = await checkTrackedOrderPaid(
      orderId,
      trackingToken
    );
    // Terminal server state (paid, reconciling, or terminally failed):
    // return immediately with no reference lookup — the row already
    // settles the order.
    if (tracked.paid || tracked.reconciliation) {
      return tracked;
    }
    // A failed transport proves nothing: remember it, but a definitive
    // reference outcome below still wins outright.
    if (tracked.inconclusive) {
      inconclusive = true;
    }
    if (tracked.terminalFailure === 'cancelled' && reference) {
      // A cancelled row proves no capture was recorded — but the supplied
      // reference may have captured late (the verify endpoint represents
      // that as order_cancelled). Verify before reporting an ordinary
      // cancellation, and prefer a definitive reference outcome; a
      // transient reference answer leaves the cancelled row standing.
      const settled = await checkReferenceSettled(
        orderId,
        reference,
        trackingToken
      );
      if (settled.paid || settled.reconciliation || settled.terminalFailure) {
        return settled;
      }
      return tracked;
    }
    if (tracked.terminalFailure) {
      return tracked;
    }
    pendingAttribution = tracked.pending;
  }
  if (reference) {
    const settled = await checkReferenceSettled(
      orderId,
      reference,
      trackingToken
    );
    // The reference finalized payment after the lookup saw pending: retain
    // the lookup's identity and breakdown so the durable claim is consumed
    // whole. The verify total and normalized currency win when present
    // (same order, same money).
    if (settled.paid && pendingAttribution) {
      return {
        paid: true,
        ...pendingAttribution,
        total: settled.total ?? pendingAttribution.total,
        currency: settled.currency ?? pendingAttribution.currency,
      };
    }
    if (settled.paid || settled.reconciliation || settled.terminalFailure) {
      return settled;
    }
    // A nonterminal reference envelope proves nothing new: keep the
    // lookup's inconclusive flag so the reconciliation-parameter hook
    // retries instead of treating the order as definitively unpaid.
    return inconclusive ? { paid: false, inconclusive: true } : settled;
  }
  return inconclusive ? { paid: false, inconclusive: true } : { paid: false };
}

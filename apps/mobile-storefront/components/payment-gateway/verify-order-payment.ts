import { CHECKOUT_API_BASE_URL } from '@/components/checkout/checkout-screen.constants';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';
import { getSession } from '@/lib/supabase';
import type { TrackedCompletionAttribution } from '@/lib/tracked-order-completion';
import {
  checkTrackedOrderPaid,
  type TrackedOrderVerification,
  VERIFY_TIMEOUT_MS,
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
}

const RECONCILING_FINALIZATION_OUTCOMES = new Set([
  'order_cancelled',
  'order_skipped',
]);

// Permanent reference defects: the attempt itself is invalid (wrong
// amount/currency, unknown reference, non-order reference), so no webhook
// or settlement poll can make it succeed. The API returns these as 4xx
// envelopes with a machine-readable code plus the processed reference;
// the client only trusts them when the echoed reference matches the one
// it sent, binding the envelope to this request.
const PERMANENT_VERIFICATION_CODES = new Set([
  'amount_mismatch',
  'currency_mismatch',
  'reference_not_found',
  'reference_not_order_payment',
]);

function finiteOrUndefined(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

interface VerifyReferenceResponse {
  success?: boolean;
  status?: string;
  finalizationOutcome?: string;
  orderId?: string;
  orderTotal?: number;
  code?: string;
  reference?: string;
}

function toVerifyReferenceResponse(value: unknown): VerifyReferenceResponse {
  return value && typeof value === 'object'
    ? (value as VerifyReferenceResponse)
    : {};
}

async function checkReferenceSettled(
  orderId: string,
  reference: string,
  trackingToken?: string | null
): Promise<OrderPaymentVerification> {
  try {
    // The verify route enforces CSRF protection, which accepts Bearer
    // authentication for native callers. Guests have no session and rely
    // on the tracking-token lookup above (a proof-bound GET with no CSRF
    // requirement) instead. Forward that same token so the route can
    // authorize this reference verification proof-bound.
    let accessToken: string | null = null;
    try {
      accessToken = (await getSession())?.access_token ?? null;
    } catch {
      accessToken = null;
    }
    const response = await fetchWithTimeout(
      `${CHECKOUT_API_BASE_URL}/api/payments/verify`,
      {
        timeout: VERIFY_TIMEOUT_MS,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          reference,
          ...(trackingToken ? { trackingToken } : {}),
        }),
      }
    );
    const data = toVerifyReferenceResponse(
      await response.json().catch(() => null)
    );
    // Only a completed finalization counts: the endpoint also reports
    // success for cancelled/skipped orders, which are not paid conversions.
    // The identity check fails closed: the route's orderId and the
    // provider reference are independently supplied, so a completed
    // envelope for order B (or a version-skewed envelope with no orderId
    // at all) must never prove that order A was paid.
    if (
      !response.ok ||
      data.success !== true ||
      data.finalizationOutcome !== 'completed' ||
      data.orderId !== orderId
    ) {
      // A definitive failed/cancelled envelope for THIS order is terminal:
      // collapsing it into the transient pending shape would clear the
      // cart and present "Order Confirmed" for a payment that cannot
      // settle. Anything else (pending, network-shaped, or foreign) stays
      // transient so settlement polling can still complete the order.
      // The route reports terminal provider outcomes as success:false
      // with the trusted order identity — never success:true — so the
      // failure gate keys on status plus identity, not on success.
      if (
        response.ok &&
        data.orderId === orderId &&
        (data.status === 'failed' ||
          data.status === 'cancelled' ||
          data.status === 'abandoned')
      ) {
        return { paid: false, terminalFailure: data.status };
      }
      // Captured money with no active paid order left: same identity gate
      // as the terminal failure above — a foreign envelope must never
      // reconcile this order.
      if (
        response.ok &&
        data.success === true &&
        data.orderId === orderId &&
        typeof data.finalizationOutcome === 'string' &&
        RECONCILING_FINALIZATION_OUTCOMES.has(data.finalizationOutcome)
      ) {
        return {
          paid: false,
          reconciliation:
            data.finalizationOutcome === 'order_skipped'
              ? 'order_skipped'
              : 'order_cancelled',
        };
      }
      // Permanent reference defects (amount/currency mismatch, unknown or
      // non-order reference): no webhook or poll can repair the attempt,
      // so report terminal failure instead of transient and preserve the
      // cart/error path. Trusts only an envelope echoing this request's
      // reference — a skewed envelope for another reference stays
      // transient.
      if (
        data.reference === reference &&
        typeof data.code === 'string' &&
        PERMANENT_VERIFICATION_CODES.has(data.code)
      ) {
        return { paid: false, terminalFailure: 'failed' };
      }
      return { paid: false };
    }
    return { paid: true, total: finiteOrUndefined(data.orderTotal) };
  } catch {
    return { paid: false };
  }
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
    // whole. The verify total wins when finite (same order, same total).
    if (settled.paid && pendingAttribution) {
      return {
        paid: true,
        ...pendingAttribution,
        total: settled.total ?? pendingAttribution.total,
      };
    }
    return settled;
  }
  return { paid: false };
}

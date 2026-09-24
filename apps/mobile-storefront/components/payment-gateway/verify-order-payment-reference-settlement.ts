import { CHECKOUT_API_BASE_URL } from '@/components/checkout/checkout-screen.constants';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';
import { getSession } from '@/lib/supabase';
import type { OrderPaymentVerification } from './verify-order-payment';
import { VERIFY_TIMEOUT_MS } from './verify-order-payment-tracked-lookup';

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
  currency?: string;
  code?: string;
  reference?: string;
}

function verifiedCurrency(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toVerifyReferenceResponse(value: unknown): VerifyReferenceResponse {
  return value && typeof value === 'object'
    ? (value as VerifyReferenceResponse)
    : {};
}

export async function checkReferenceSettled(
  orderId: string,
  reference: string,
  trackingToken?: string | null
): Promise<OrderPaymentVerification> {
  try {
    // The verify route enforces CSRF protection on POST, which accepts
    // session header auth for native callers. Guests have no session:
    // they prove their order through the read-only GET entry with the
    // creation tracking token (CSRF covers non-GET requests only).
    // Without a token there is no proof to send — report inconclusive
    // so the reconciliation hook retries instead of coercing to unpaid.
    let accessToken: string | null = null;
    try {
      accessToken = (await getSession())?.access_token ?? null;
    } catch {
      accessToken = null;
    }
    if (!accessToken && !trackingToken) {
      return { paid: false, inconclusive: true };
    }
    // Prefer the proof-bound GET whenever the creation tracking token is
    // available: it recognizes any completed/paid transaction, while the
    // Bearer POST path only settles locally finalized Paystack, Korapay,
    // and Juicyway rows — completed wallet references and asynchronously
    // settled CredPal/Klump references would otherwise poll pending
    // forever for signed-in shoppers.
    const useBearerPost = !!accessToken && !trackingToken;
    const verifyUrl = useBearerPost
      ? `${CHECKOUT_API_BASE_URL}/api/payments/verify`
      : `${CHECKOUT_API_BASE_URL}/api/payments/verify?reference=${encodeURIComponent(reference)}&trackingToken=${encodeURIComponent(trackingToken ?? '')}`;
    const response = await fetchWithTimeout(
      verifyUrl,
      useBearerPost
        ? {
            timeout: VERIFY_TIMEOUT_MS,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ reference }),
          }
        : { timeout: VERIFY_TIMEOUT_MS, method: 'GET' }
    );
    const rawBody = await response.json().catch(() => null);
    if (response.ok && rawBody == null) {
      // 200 with an unparseable body: the server answered but proved
      // nothing — inconclusive, never a verified negative.
      return { paid: false, inconclusive: true };
    }
    const data = toVerifyReferenceResponse(rawBody);
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
    // The endpoint returns the normalized transaction currency on the
    // finalized branches: keep it alongside the total so completions
    // without a tracked-order lookup (no token, failed lookup) still
    // settle in the stamped currency instead of defaulting to NGN.
    const currency = verifiedCurrency(data.currency);
    return {
      paid: true,
      total: finiteOrUndefined(data.orderTotal),
      ...(currency ? { currency } : {}),
    };
  } catch {
    // Network failure or timeout: the lookup proved nothing either way.
    return { paid: false, inconclusive: true };
  }
}

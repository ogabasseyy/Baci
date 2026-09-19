import { CHECKOUT_API_BASE_URL } from '@/components/checkout/checkout-screen.constants';
import type { TrackOrderData } from '@/components/track-order/TrackOrderScreen.types';
import {
  TRACK_ORDER_API_BASE_URL,
  TRACK_ORDER_MERCHANT_SLUG,
} from '@/components/track-order/track-order.config';
import { getSession } from '@/lib/supabase';
import {
  type TrackedCompletionAttribution,
  toTrackedCompletionAttribution,
} from '@/lib/tracked-order-completion';

const VERIFY_TIMEOUT_MS = 15_000;

interface VerifyOrderPaymentInput {
  orderId?: string;
  trackingToken?: string;
  reference?: string;
}

export interface OrderPaymentVerification extends TrackedCompletionAttribution {
  paid: boolean;
}

function finiteOrUndefined(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function toTrackedOrder(value: unknown): TrackOrderData['order'] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const order = (value as { order?: unknown }).order;
  if (!order || typeof order !== 'object') {
    return null;
  }
  return order as TrackOrderData['order'];
}

function toTrackedCustomer(value: unknown): TrackOrderData['customer'] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const customer = (value as { customer?: unknown }).customer;
  if (!customer || typeof customer !== 'object') {
    return null;
  }
  return customer as TrackOrderData['customer'];
}

function toTrackedItems(value: unknown): TrackOrderData['items'] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? (items as TrackOrderData['items']) : [];
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkTrackedOrderPaid(
  orderId: string,
  trackingToken: string
): Promise<OrderPaymentVerification> {
  try {
    const response = await fetchWithTimeout(
      `${TRACK_ORDER_API_BASE_URL}/api/storefront/orders/track-order?token=${encodeURIComponent(trackingToken)}&merchant_slug=${encodeURIComponent(TRACK_ORDER_MERCHANT_SLUG)}`,
      {}
    );
    if (!response.ok) {
      return { paid: false };
    }
    const body: unknown = await response.json();
    const order = toTrackedOrder(body);
    if (!order || order.id !== orderId || order.payment_status !== 'paid') {
      return { paid: false };
    }
    return {
      paid: true,
      ...toTrackedCompletionAttribution(
        order,
        toTrackedCustomer(body),
        toTrackedItems(body)
      ),
    };
  } catch {
    return { paid: false };
  }
}

interface VerifyReferenceResponse {
  success?: boolean;
  status?: string;
  finalizationOutcome?: string;
  orderId?: string;
  orderTotal?: number;
}

function toVerifyReferenceResponse(value: unknown): VerifyReferenceResponse {
  return value && typeof value === 'object'
    ? (value as VerifyReferenceResponse)
    : {};
}

async function checkReferenceSettled(
  orderId: string,
  reference: string
): Promise<OrderPaymentVerification> {
  try {
    // The verify route enforces CSRF protection, which accepts Bearer
    // authentication for native callers. Guests have no session and rely
    // on the tracking-token lookup above (a proof-bound GET with no CSRF
    // requirement) instead.
    let accessToken: string | null = null;
    try {
      accessToken = (await getSession())?.access_token ?? null;
    } catch {
      accessToken = null;
    }
    const response = await fetchWithTimeout(
      `${CHECKOUT_API_BASE_URL}/api/payments/verify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ reference }),
      }
    );
    const data = toVerifyReferenceResponse(
      await response.json().catch(() => null)
    );
    // Only a completed finalization counts: the endpoint also reports
    // success for cancelled/skipped orders, which are not paid conversions.
    if (
      !response.ok ||
      data.success !== true ||
      data.finalizationOutcome !== 'completed' ||
      (typeof data.orderId === 'string' && data.orderId !== orderId)
    ) {
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
  if (trackingToken) {
    const tracked = await checkTrackedOrderPaid(orderId, trackingToken);
    if (tracked.paid) {
      return tracked;
    }
  }
  if (reference) {
    return checkReferenceSettled(orderId, reference);
  }
  return { paid: false };
}

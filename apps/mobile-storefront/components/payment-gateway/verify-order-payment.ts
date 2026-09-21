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

interface TrackedOrderRead {
  order: TrackOrderData['order'];
  customer: TrackOrderData['customer'] | null;
  items: TrackOrderData['items'];
}

async function readTrackedOrder(
  orderId: string,
  trackingToken: string
): Promise<TrackedOrderRead | null> {
  try {
    const response = await fetchWithTimeout(
      `${TRACK_ORDER_API_BASE_URL}/api/storefront/orders/track-order?token=${encodeURIComponent(trackingToken)}&merchant_slug=${encodeURIComponent(TRACK_ORDER_MERCHANT_SLUG)}`,
      {}
    );
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    const order = toTrackedOrder(body);
    if (!order || order.id !== orderId) {
      return null;
    }
    return {
      order,
      customer: toTrackedCustomer(body),
      items: toTrackedItems(body),
    };
  } catch {
    return null;
  }
}

async function checkTrackedOrderPaid(
  orderId: string,
  trackingToken: string
): Promise<
  OrderPaymentVerification & { pending?: TrackedCompletionAttribution }
> {
  const read = await readTrackedOrder(orderId, trackingToken);
  if (!read) {
    return { paid: false };
  }
  const attribution = toTrackedCompletionAttribution(
    read.order,
    read.customer,
    read.items
  );
  if (read.order.payment_status !== 'paid') {
    // Unpaid now, but the projection already carries the checkout identity
    // and breakdown the finalized path below would otherwise lose.
    return { paid: false, pending: attribution };
  }
  return { paid: true, ...attribution };
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
    const tracked = await checkTrackedOrderPaid(orderId, trackingToken);
    if (tracked.paid) {
      return tracked;
    }
    pendingAttribution = tracked.pending;
  }
  if (reference) {
    const settled = await checkReferenceSettled(orderId, reference);
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

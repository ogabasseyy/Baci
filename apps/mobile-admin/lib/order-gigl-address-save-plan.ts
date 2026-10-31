import type { OrderGiglReceiver } from './order-gigl-shipping';
import { sanitizeAddress, sanitizePhone, sanitizeText } from './sanitize';

export interface OrderGiglStoredAddressSource {
  customer_name?: string | null;
  customer_phone?: string | null;
  selected_quote_id?: string | null;
  shipping_address?: unknown;
  shipping_funding_source?: string | null;
}

export type OrderGiglAddressSavePlan =
  | { kind: 'unchanged' }
  | { kind: 'locked' }
  | { kind: 'save'; shippingAddress: Record<string, unknown> };

type ReceiverTextField = 'address' | 'city' | 'phone' | 'state';

const SANITIZERS: Record<ReceiverTextField, (value: string) => string> = {
  address: sanitizeAddress,
  city: (value) => sanitizeText(value, 100),
  phone: sanitizePhone,
  state: (value) => sanitizeText(value, 100),
};

function trimmed(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function coordinate(value: unknown, limit: number) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit
    ? parsed
    : undefined;
}

/**
 * bind_admin_gigl_quote refuses a receiver that differs from the order's
 * stored shipping_address (stale_order_quote_inputs). Address details typed in
 * the GIG panel, the customer_phone fallback for a blank stored phone, and the
 * server's customer_name fallback for a missing stored name all differ, so
 * they must be saved to the order before the bound quote is requested.
 */
export function planOrderGiglAddressSave(
  order: OrderGiglStoredAddressSource,
  receiver: OrderGiglReceiver
): OrderGiglAddressSavePlan {
  const raw = order.shipping_address;
  // A legacy string address reads as empty on the server, so it is replaced.
  const stored: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  const next: Record<string, unknown> = { ...stored };
  let changed = false;
  for (const field of Object.keys(SANITIZERS) as ReceiverTextField[]) {
    const value = receiver[field];
    // Omitted receiver fields keep the stored value, as the server merge does.
    if (value === undefined || trimmed(value) === trimmed(stored[field])) {
      continue;
    }
    next[field] = SANITIZERS[field](value);
    changed = true;
  }
  const customerName = trimmed(order.customer_name);
  if ((stored.name === undefined || stored.name === null) && customerName) {
    next.name = customerName;
    changed = true;
  }
  const { latitude, longitude } = receiver;
  if (latitude !== undefined && longitude !== undefined) {
    if (
      coordinate(stored.latitude, 90) !== latitude ||
      coordinate(stored.longitude, 180) !== longitude
    ) {
      next.latitude = latitude;
      next.longitude = longitude;
      changed = true;
    }
  } else if (trimmed(receiver.address) !== trimmed(stored.address)) {
    // A new street invalidates the old map pin, matching the server merge.
    delete next.latitude;
    delete next.longitude;
  }
  if (!changed) return { kind: 'unchanged' };
  // The order edit clears a saved quote, and checkout-funded shipping must keep
  // its paid destination, so those orders are never rewritten from the panel.
  if (
    order.selected_quote_id ||
    order.shipping_funding_source === 'customer_checkout'
  ) {
    return { kind: 'locked' };
  }
  return { kind: 'save', shippingAddress: next };
}

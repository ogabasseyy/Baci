import type { TrackOrderData } from '@/components/track-order/TrackOrderScreen.types';
import type { CheckoutTrackingItem } from '@/services/tiktok-checkout-route-tracking';

export interface TrackedCompletionAttribution {
  customerEmail?: string;
  customerPhone?: string;
  items?: CheckoutTrackingItem[];
  shipping?: number;
  subtotal?: number;
  tax?: number;
  total?: number;
  currency?: string;
}

function finiteOrUndefined(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function toTrackingItems(
  items: TrackOrderData['items']
): CheckoutTrackingItem[] | undefined {
  if (!Array.isArray(items) || items.length === 0) {
    return undefined;
  }
  const mapped = items
    .filter(
      (item): item is TrackOrderData['items'][number] =>
        !!item && typeof item === 'object'
    )
    .map((item) => ({
      product_id: String(item.product_id ?? item.id ?? ''),
      quantity: Number(item.quantity) || 0,
      ...(finiteOrUndefined(item.unit_price) !== undefined
        ? { price: Number(item.unit_price) }
        : {}),
      ...(typeof item.product_name === 'string' && item.product_name
        ? { name: item.product_name }
        : {}),
    }))
    .filter((item) => item.product_id.length > 0 && item.quantity > 0);
  return mapped.length > 0 ? mapped : undefined;
}

// Derives the authoritative purchase attribution from a server look-up.
// The projection carries the authoritative tax amount: prefer it. Without
// it, tax is derived from the canonical identity total = subtotal +
// shipping + gift wrap − discount + tax, so every total component must be
// present — otherwise a gift-wrapped order would report tax + wrapping fee
// as tax. Only kept when the result is non-negative; otherwise it stays
// undefined and the caller default applies.
export function toTrackedCompletionAttribution(
  order: TrackOrderData['order'] | null,
  customer: TrackOrderData['customer'] | null,
  items?: TrackOrderData['items']
): TrackedCompletionAttribution {
  if (!order) {
    return {};
  }
  const total = finiteOrUndefined(order.total);
  const subtotal = finiteOrUndefined(order.subtotal);
  const shipping = finiteOrUndefined(order.shipping_cost);
  const discount = finiteOrUndefined(order.discount_amount);
  // Null means the projection did not carry the component (Number(null)
  // is 0, which would corrupt the derivation), so coalesce to undefined.
  const authoritativeTax = finiteOrUndefined(order.tax_amount ?? undefined);
  const giftWrap = finiteOrUndefined(order.gift_wrapping_fee ?? undefined);
  let tax: number | undefined;
  if (authoritativeTax !== undefined && authoritativeTax >= 0) {
    tax = authoritativeTax;
  } else if (
    total !== undefined &&
    subtotal !== undefined &&
    shipping !== undefined &&
    discount !== undefined
  ) {
    // Legacy projections predate gift-wrapping: assume no wrapping fee
    // only when the field is absent entirely.
    const wrap = giftWrap ?? 0;
    const derived = total - subtotal - shipping - wrap + discount;
    if (Number.isFinite(derived) && derived >= 0) {
      tax = derived;
    }
  }
  const trackedItems = toTrackingItems(items ?? []);
  return {
    ...(typeof customer?.email === 'string' && customer.email
      ? { customerEmail: customer.email }
      : {}),
    ...(typeof customer?.phone === 'string' && customer.phone
      ? { customerPhone: customer.phone }
      : {}),
    ...(trackedItems ? { items: trackedItems } : {}),
    ...(shipping !== undefined ? { shipping } : {}),
    ...(subtotal !== undefined ? { subtotal } : {}),
    ...(tax !== undefined ? { tax } : {}),
    ...(total !== undefined ? { total } : {}),
    // The tracked order stamps its currency: forward it so settlement
    // keeps the creation currency instead of defaulting to NGN. Absent
    // values keep the default exactly as before.
    ...(typeof order.currency === 'string' && order.currency
      ? { currency: order.currency }
      : {}),
  };
}

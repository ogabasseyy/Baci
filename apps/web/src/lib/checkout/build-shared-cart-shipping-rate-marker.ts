import type { SharedCartRateBinding } from './shared-cart-rate-binding';

/** Marker belongs in the binder's JSON p_args; it is not an inner RPC arg. */
export function buildSharedCartShippingRateMarker({
  enabled,
  sharedCart,
  shippingRateId,
}: {
  enabled: boolean;
  sharedCart: SharedCartRateBinding | undefined;
  shippingRateId: string | null | undefined;
}): { p_shipping_rate_id: string | null } | null {
  if (!enabled || !sharedCart) return null;
  return { p_shipping_rate_id: shippingRateId ?? null };
}

import type { CartItem } from './cart-store.types';

const NGN_PRICE_FORMATTER = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format price in Naira
 */
export function formatPrice(amount: number): string {
  return NGN_PRICE_FORMATTER.format(amount);
}

let cachedCartItems: CartItem[] | null = null;
let cachedCartQuantities = new Map<string, number>();

/**
 * Memoized map of `product_id` → total quantity, rebuilt only when `items`
 * changes. Returns a read-only map (do not mutate the shared cache). Lets each
 * product card read its count in O(1) (a number primitive) instead of an
 * O(items) filter+reduce scan per card.
 */
export function selectCartQuantities(state: {
  items: CartItem[];
}): ReadonlyMap<string, number> {
  if (state.items !== cachedCartItems) {
    cachedCartItems = state.items;
    const next = new Map<string, number>();
    for (const item of state.items) {
      const key = String(item.product_id);
      next.set(key, (next.get(key) ?? 0) + item.quantity);
    }
    cachedCartQuantities = next;
  }
  return cachedCartQuantities;
}

/**
 * Clears any negotiated price from every cart line. A cart-wide (group)
 * negotiation distributes one accepted total across all lines, so any change to
 * cart composition (add / remove / quantity) or a catalog price drift
 * invalidates it — callers then turn the `cartWideNegotiationActive` flag off.
 */
export function clearGroupNegotiation(items: CartItem[]): CartItem[] {
  return items.map((item) =>
    item.negotiatedPrice === undefined && item.negotiationStatus === undefined
      ? item
      : { ...item, negotiatedPrice: undefined, negotiationStatus: undefined }
  );
}

/**
 * Reconciles cart line prices (and refreshed offer conditions) against live
 * catalog values keyed by cart line id, returning the cart-store partial to
 * apply. Lines within the ±₦1 parity tolerance are treated as unchanged
 * (so an accepted negotiated price is not cleared for rounding noise). A
 * condition refresh counts as a real change (the line's economics moved),
 * so it clears the line negotiation like a price drift does. When a real
 * drift clears any negotiation and a cart-wide deal is active, the whole
 * group is reset.
 */
export function applyReprice(
  state: { items: CartItem[]; cartWideNegotiationActive: boolean },
  priceById: Record<string, number>,
  conditionById: Record<string, string> = {}
): { items: CartItem[]; cartWideNegotiationActive?: boolean } {
  let changed = false;
  let items = state.items.map((item) => {
    const livePrice = priceById[item.id];
    const liveCondition = conditionById[item.id];
    const priceDrifted =
      typeof livePrice === 'number' &&
      Number.isFinite(livePrice) &&
      Math.abs(livePrice - item.price) > 1;
    const conditionDrifted =
      typeof liveCondition === 'string' &&
      liveCondition !== '' &&
      liveCondition !== item.condition;
    if (!priceDrifted && !conditionDrifted) {
      return item;
    }
    changed = true;
    return {
      ...item,
      ...(priceDrifted ? { price: livePrice as number } : null),
      ...(conditionDrifted ? { condition: liveCondition as string } : null),
      negotiatedPrice: undefined,
      negotiationStatus: undefined,
    };
  });
  if (!changed) {
    return { items };
  }
  if (state.cartWideNegotiationActive) {
    items = clearGroupNegotiation(items);
  }
  return { items, cartWideNegotiationActive: false };
}

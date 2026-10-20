import { type CartItemIdentity, cartLineIdentity } from '@baci/shared/cart';

/**
 * The shared planner can report one conflict per attachment lane, so
 * sibling lanes of the same base item arrive with identical line
 * identities. Panels key choices by that identity (one shopper pick
 * resolves every sibling lane), so collapse duplicates at the store
 * boundary instead of rendering redundant choices or submitting
 * duplicate resolutions.
 */
export function dedupeMergeConflictItems(
  items: CartItemIdentity[]
): CartItemIdentity[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = cartLineIdentity(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

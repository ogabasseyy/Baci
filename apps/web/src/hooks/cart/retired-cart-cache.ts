/**
 * Erase only this merchant's parked guest and retiring-user cart
 * payloads. Returns false when storage is unavailable or a removal
 * failed, so callers keep the retirement fence for a later retry
 * instead of exposing the previous account's cache.
 */
export function eraseRetiredCartCache(
  slug?: string | null,
  retiringUserId?: string | null
): boolean {
  try {
    const storage = window.localStorage;
    const prefix = slug ? `baci-cart-${slug}-` : 'baci-cart-';
    const keys = Array.from({ length: storage.length }, (_, i) =>
      storage.key(i)
    );
    let erased = true;
    const remove = (key: string) => {
      try {
        storage.removeItem(key);
      } catch {
        erased = false;
      }
    };
    for (const key of keys) {
      if (!key?.startsWith(prefix)) continue;
      const suffix = key.slice(prefix.length);
      if (
        suffix === 'guest' ||
        suffix === 'group-negotiation' ||
        suffix === 'shared-import' ||
        (retiringUserId != null && suffix === retiringUserId)
      )
        remove(key);
    }
    // Historical unscoped payloads belong to the merchant-less fallback;
    // only a merchant-less retirement may erase them.
    if (!slug) {
      remove('baci-cart');
      remove('baci-cart-guest');
    }
    return erased;
  } catch {
    return false;
  }
}

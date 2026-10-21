/** Erase only this merchant's parked guest and retiring-user cart payloads. */
export function eraseRetiredCartCache(
  slug?: string | null,
  retiringUserId?: string | null
): void {
  const storage = window.localStorage;
  const prefix = slug ? `baci-cart-${slug}-` : 'baci-cart-';
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) {
    if (!key?.startsWith(prefix)) continue;
    const suffix = key.slice(prefix.length);
    if (
      suffix === 'guest' ||
      suffix === 'group-negotiation' ||
      suffix === 'shared-import' ||
      (retiringUserId != null && suffix === retiringUserId)
    )
      storage.removeItem(key);
  }
  // Historical unscoped payloads belong to the merchant-less fallback;
  // only a merchant-less retirement may erase them.
  if (!slug) {
    storage.removeItem('baci-cart');
    storage.removeItem('baci-cart-guest');
  }
}

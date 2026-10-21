/** Erase only this merchant's parked guest and Supabase-user cart payloads. */
export function eraseRetiredCartCache(slug?: string | null): void {
  const storage = window.localStorage;
  const prefix = slug ? `baci-cart-${slug}-` : 'baci-cart-';
  const userId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) {
    if (!key?.startsWith(prefix)) continue;
    const suffix = key.slice(prefix.length);
    if (suffix === 'guest' || userId.test(suffix)) storage.removeItem(key);
  }
  // Historical unscoped payloads are not safe to adopt after retirement.
  storage.removeItem('baci-cart');
  storage.removeItem('baci-cart-guest');
}

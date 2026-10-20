export type MerchantFeatureGate =
  | 'custom_domain'
  | 'growth_integrations'
  | 'marketplace_sync'
  | 'shared_cart'
  | 'shared_cart_accounts'
  | 'shared_cart_realtime';

export type MerchantFeatureSource = {
  plan_expires_at?: string | null;
  plan_tier?: string | null;
  premium_features?: unknown;
  shared_cart_enabled?: boolean;
  shared_cart_accounts_enabled?: boolean;
  shared_cart_realtime_enabled?: boolean;
};

export function merchantHasFeature(
  merchant: MerchantFeatureSource | null | undefined,
  feature: MerchantFeatureGate,
  now?: Date
): boolean {
  if (
    feature === 'shared_cart' ||
    feature === 'shared_cart_accounts' ||
    feature === 'shared_cart_realtime'
  ) {
    // Server callers with raw enrollment stay authoritative. The public
    // snapshot intentionally exposes only derived presentation hints.
    if (Array.isArray(merchant?.premium_features)) {
      return merchant.premium_features.some((value) => value === feature);
    }
    return merchant?.[`${feature}_enabled`] === true;
  }
  const features = new Set(
    Array.isArray(merchant?.premium_features)
      ? merchant.premium_features
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      : []
  );
  if (features.has(feature)) return true;
  if (features.has('all_features')) return true;

  const allowedTiers: Record<MerchantFeatureGate, ReadonlySet<string>> = {
    custom_domain: new Set(['starter', 'pro', 'business', 'enterprise']),
    growth_integrations: new Set(['pro', 'business', 'enterprise']),
    marketplace_sync: new Set(['pro', 'business', 'enterprise']),
    // Shared-cart enrollment stays disabled for every plan until the pilot
    // gates pass; only an explicit premium_features grant enables it.
    shared_cart: new Set([]),
    shared_cart_accounts: new Set([]),
    shared_cart_realtime: new Set([]),
  };
  if (!merchant?.plan_tier || !allowedTiers[feature].has(merchant.plan_tier)) {
    return false;
  }
  if (!merchant.plan_expires_at) return true;
  const expiryTime = Date.parse(merchant.plan_expires_at);
  return (
    Number.isFinite(expiryTime) && expiryTime > (now ?? new Date()).getTime()
  );
}

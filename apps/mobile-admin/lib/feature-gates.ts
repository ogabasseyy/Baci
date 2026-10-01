type PlanTier = 'free' | 'starter' | 'pro' | 'business' | 'enterprise';

export type MobileFeatureGate =
  | 'advanced_analytics'
  | 'custom_domain'
  | 'custom_email_domain'
  | 'growth_integrations'
  | 'marketplace_sync'
  | 'product_limit';

type FeatureGateMerchant = {
  plan_expires_at?: string | null;
  plan_tier?: string | null;
  premium_features?: unknown;
};

type ProductCreationGateInput = {
  activeProductCount: number | null | undefined;
  // Server-backed product limits are enforced from merchant DB entitlements.
  // This legacy input is intentionally ignored until RevenueCat entitlements
  // are mirrored and verified server-side.
  hasRevenueCatPro?: boolean;
  merchant: FeatureGateMerchant | null | undefined;
  now?: Date;
};

const FREE_PRODUCT_LIMIT = 1000;
const PAID_PLAN_TIERS = new Set<PlanTier>(['pro', 'business', 'enterprise']);
const FEATURE_PLAN_TIERS: Record<MobileFeatureGate, Set<PlanTier>> = {
  advanced_analytics: PAID_PLAN_TIERS,
  custom_domain: new Set(['starter', 'pro', 'business', 'enterprise']),
  custom_email_domain: PAID_PLAN_TIERS,
  growth_integrations: PAID_PLAN_TIERS,
  marketplace_sync: PAID_PLAN_TIERS,
  product_limit: PAID_PLAN_TIERS,
};
const ALL_FEATURES = 'all_features';

const PRODUCT_LIMIT_FEATURE_ALIASES = new Set([
  'product_limit',
  'unlimited_products',
  'bulk_product_import',
]);

function normalizePlanTier(value: string | null | undefined): PlanTier {
  if (
    value === 'starter' ||
    value === 'pro' ||
    value === 'business' ||
    value === 'enterprise'
  ) {
    return value;
  }

  return 'free';
}

function normalizePremiumFeatures(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set();
  }

  return new Set(
    value
      .filter((feature): feature is string => typeof feature === 'string')
      .map((feature) => feature.trim().toLowerCase())
      .filter(Boolean)
  );
}

function hasActivePaidPlan(merchant: FeatureGateMerchant, now: Date): boolean {
  const tier = normalizePlanTier(merchant.plan_tier);

  if (!PAID_PLAN_TIERS.has(tier)) {
    return false;
  }

  if (!merchant.plan_expires_at) {
    return true;
  }

  const expiryTime = Date.parse(merchant.plan_expires_at);
  return Number.isFinite(expiryTime) && expiryTime > now.getTime();
}

function hasProductLimitGrant(features: Set<string>): boolean {
  return (
    features.has(ALL_FEATURES) ||
    [...PRODUCT_LIMIT_FEATURE_ALIASES].some((feature) => features.has(feature))
  );
}

function merchantHasFullProAccess(
  merchant: FeatureGateMerchant | null | undefined,
  now: Date
): boolean {
  const features = normalizePremiumFeatures(merchant?.premium_features);

  if (features.has(ALL_FEATURES)) {
    return true;
  }

  return Boolean(merchant && hasActivePaidPlan(merchant, now));
}

export const baciFeatureGates = {
  FREE_PRODUCT_LIMIT,

  canCreateProduct({
    activeProductCount,
    merchant,
    now = new Date(),
  }: ProductCreationGateInput) {
    const numericCount = Number(activeProductCount);
    const hasKnownCount = Number.isFinite(numericCount);
    const count = hasKnownCount ? Math.max(0, numericCount) : 0;
    const features = normalizePremiumFeatures(merchant?.premium_features);
    const hasUnlimitedProducts =
      Boolean(merchant && hasActivePaidPlan(merchant, now)) ||
      hasProductLimitGrant(features);
    const allowed =
      hasUnlimitedProducts || !hasKnownCount || count < FREE_PRODUCT_LIMIT;

    return {
      allowed,
      hasKnownCount,
      limit: FREE_PRODUCT_LIMIT,
      remaining: hasUnlimitedProducts
        ? Number.POSITIVE_INFINITY
        : Math.max(0, FREE_PRODUCT_LIMIT - count),
      requiresUpgrade: !allowed,
    };
  },

  hasFeature(
    merchant: FeatureGateMerchant | null | undefined,
    feature: MobileFeatureGate,
    now = new Date()
  ): boolean {
    const features = normalizePremiumFeatures(merchant?.premium_features);

    if (features.has(ALL_FEATURES) || features.has(feature)) {
      return true;
    }

    if (!merchant) {
      return false;
    }

    const tier = normalizePlanTier(merchant.plan_tier);
    const allowedPlanTiers = FEATURE_PLAN_TIERS[feature];
    if (!allowedPlanTiers.has(tier)) {
      return false;
    }

    if (!merchant.plan_expires_at) {
      return true;
    }

    const expiryTime = Date.parse(merchant.plan_expires_at);
    return Number.isFinite(expiryTime) && expiryTime > now.getTime();
  },

  hasFullProAccess(
    merchant: FeatureGateMerchant | null | undefined,
    now = new Date()
  ): boolean {
    return merchantHasFullProAccess(merchant, now);
  },
};

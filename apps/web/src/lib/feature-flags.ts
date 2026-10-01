/**
 * Feature Flags System for Baci
 *
 * Controls access to premium features based on merchant subscription plan.
 * Used to gate Smart Cart Pro and other premium features.
 */

// Feature keys - add new features here
export const FEATURES = {
  // Smart Cart Pro features
  PRICE_NEGOTIATION: 'price_negotiation',
  DEVICE_ASSURANCE: 'device_assurance',
  SMART_UPSELLS: 'smart_upsells',
  CART_ABANDONMENT: 'cart_abandonment',
  CART_ANALYTICS: 'cart_analytics',

  // Other premium features
  CUSTOM_DOMAIN: 'custom_domain',
  CUSTOM_EMAIL_DOMAIN: 'custom_email_domain',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  PRIORITY_SUPPORT: 'priority_support',
  AI_PRODUCT_DESCRIPTIONS: 'ai_product_descriptions',
  BULK_PRODUCT_IMPORT: 'bulk_product_import',
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

// Plan tiers
export const PLAN_TIERS = [
  'free',
  'starter',
  'pro',
  'business',
  'enterprise',
] as const;

export type PlanTier = (typeof PLAN_TIERS)[number];

export function isPlanTier(
  value: string | null | undefined
): value is PlanTier {
  return typeof value === 'string' && PLAN_TIERS.some((tier) => tier === value);
}

// Default features by plan
const PLAN_FEATURES: Record<PlanTier, FeatureKey[]> = {
  free: [],
  starter: [FEATURES.CUSTOM_DOMAIN],
  pro: [
    FEATURES.CUSTOM_DOMAIN,
    FEATURES.CUSTOM_EMAIL_DOMAIN,
    FEATURES.PRICE_NEGOTIATION,
    FEATURES.DEVICE_ASSURANCE,
    FEATURES.SMART_UPSELLS,
    FEATURES.AI_PRODUCT_DESCRIPTIONS,
  ],
  business: [
    FEATURES.CUSTOM_DOMAIN,
    FEATURES.CUSTOM_EMAIL_DOMAIN,
    FEATURES.PRICE_NEGOTIATION,
    FEATURES.DEVICE_ASSURANCE,
    FEATURES.SMART_UPSELLS,
    FEATURES.CART_ABANDONMENT,
    FEATURES.CART_ANALYTICS,
    FEATURES.AI_PRODUCT_DESCRIPTIONS,
    FEATURES.BULK_PRODUCT_IMPORT,
    FEATURES.ADVANCED_ANALYTICS,
  ],
  enterprise: [
    // All features
    ...Object.values(FEATURES),
  ],
};

// Smart Cart Pro bundle
export const SMART_CART_PRO_FEATURES: FeatureKey[] = [
  FEATURES.PRICE_NEGOTIATION,
  FEATURES.DEVICE_ASSURANCE,
  FEATURES.SMART_UPSELLS,
  FEATURES.CART_ABANDONMENT,
  FEATURES.CART_ANALYTICS,
];

/**
 * Check if a plan tier has access to a specific feature
 */
export function planHasFeature(
  planTier: PlanTier,
  feature: FeatureKey
): boolean {
  return PLAN_FEATURES[planTier]?.includes(feature) ?? false;
}

/**
 * Get all features available for a plan
 */
export function getPlanFeatures(planTier: PlanTier): FeatureKey[] {
  return PLAN_FEATURES[planTier] ?? [];
}

/**
 * Check if a plan has Smart Cart Pro
 */
export function hasSmartCartPro(planTier: PlanTier): boolean {
  // Has Smart Cart Pro if they have at least 3 of the 5 features
  const proFeatures = SMART_CART_PRO_FEATURES.filter((f) =>
    planHasFeature(planTier, f)
  );
  return proFeatures.length >= 3;
}

/**
 * Feature metadata for UI display
 */
export const FEATURE_METADATA: Record<
  FeatureKey,
  {
    name: string;
    description: string;
    icon: string;
    minPlan: PlanTier;
  }
> = {
  [FEATURES.PRICE_NEGOTIATION]: {
    name: 'Price Negotiation',
    description: 'Let customers make offers on products',
    icon: 'handshake',
    minPlan: 'pro',
  },
  [FEATURES.DEVICE_ASSURANCE]: {
    name: 'Device Assurance',
    description: 'Add warranty protection at checkout',
    icon: 'shield-check',
    minPlan: 'pro',
  },
  [FEATURES.SMART_UPSELLS]: {
    name: 'Smart Upsells',
    description: 'AI-powered product recommendations',
    icon: 'trending-up',
    minPlan: 'pro',
  },
  [FEATURES.CART_ABANDONMENT]: {
    name: 'Cart Recovery',
    description: 'Automated abandoned cart emails',
    icon: 'mail',
    minPlan: 'business',
  },
  [FEATURES.CART_ANALYTICS]: {
    name: 'Cart Analytics',
    description: 'Detailed cart behavior insights',
    icon: 'bar-chart',
    minPlan: 'business',
  },
  [FEATURES.CUSTOM_DOMAIN]: {
    name: 'Custom Domain',
    description: 'Use your own domain name',
    icon: 'globe',
    minPlan: 'starter',
  },
  [FEATURES.CUSTOM_EMAIL_DOMAIN]: {
    name: 'Custom Email Domain',
    description: 'Send emails from your own domain for better inbox delivery',
    icon: 'mail',
    minPlan: 'pro',
  },
  [FEATURES.ADVANCED_ANALYTICS]: {
    name: 'Advanced Analytics',
    description: 'Detailed sales and traffic reports',
    icon: 'activity',
    minPlan: 'business',
  },
  [FEATURES.PRIORITY_SUPPORT]: {
    name: 'Priority Support',
    description: '24/7 dedicated support team',
    icon: 'headphones',
    minPlan: 'enterprise',
  },
  [FEATURES.AI_PRODUCT_DESCRIPTIONS]: {
    name: 'AI Descriptions',
    description: 'Generate product descriptions with AI',
    icon: 'sparkles',
    minPlan: 'pro',
  },
  [FEATURES.BULK_PRODUCT_IMPORT]: {
    name: 'Bulk Import',
    description: 'Import products from CSV/Excel',
    icon: 'upload',
    minPlan: 'business',
  },
};

/**
 * Get upgrade CTA for a feature
 */
export function getUpgradeCTA(feature: FeatureKey): {
  title: string;
  description: string;
  targetPlan: PlanTier;
} {
  const metadata = FEATURE_METADATA[feature];
  return {
    title: `Unlock ${metadata.name}`,
    description: metadata.description,
    targetPlan: metadata.minPlan,
  };
}

/**
 * Whether a merchant's plan grants price negotiation.
 *
 * `merchants.plan_tier` is the single source of truth: it is NOT NULL with a
 * `'free'` default, so an absent or malformed tier is a data fault rather than
 * a legacy merchant. Fail closed instead of consulting a slug allowlist.
 */
export function hasPriceNegotiationEntitlement(
  planTier: string | null | undefined
): boolean {
  return (
    isPlanTier(planTier) && planHasFeature(planTier, FEATURES.PRICE_NEGOTIATION)
  );
}

export interface CustomEmailDomainEntitlementSource {
  plan_tier?: string | null;
  plan_expires_at?: string | null;
  premium_features?: unknown;
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

/**
 * Whether a merchant may configure / send from a custom email sending domain
 * (premium). Mirrors merchantHasFeature: an explicit premium_features grant
 * (`all_features` or the feature) wins; otherwise the plan tier must include the
 * feature AND the paid plan must not be expired (plan_expires_at in the future,
 * or absent). Fail-closed when plan_tier is absent/malformed; this feature must
 * not inherit legacy price-negotiation allowlists.
 */
export function hasCustomEmailDomainEntitlement(
  merchant: CustomEmailDomainEntitlementSource | null | undefined,
  now: Date = new Date()
): boolean {
  const features = normalizePremiumFeatures(merchant?.premium_features);
  if (
    features.has('all_features') ||
    features.has(FEATURES.CUSTOM_EMAIL_DOMAIN)
  ) {
    return true;
  }

  const planTier = merchant?.plan_tier;
  if (
    !isPlanTier(planTier) ||
    !planHasFeature(planTier, FEATURES.CUSTOM_EMAIL_DOMAIN)
  ) {
    return false;
  }

  if (!merchant?.plan_expires_at) {
    return true;
  }
  const expiryTime = Date.parse(merchant.plan_expires_at);
  return Number.isFinite(expiryTime) && expiryTime > now.getTime();
}

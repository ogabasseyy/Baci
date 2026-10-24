import { normalizeAnalyticsId } from './analytics-id';
import type { MerchantWithAnalytics } from './analytics-pixel-provider';

const ANALYTICS_ID_KEYS = [
  'chatgpt_pixel_id',
  'google_analytics_id',
  'facebook_pixel_id',
  'tiktok_pixel_id',
  'snapchat_pixel_id',
  'twitter_pixel_id',
] as const satisfies ReadonlyArray<keyof MerchantWithAnalytics>;
const ALL_FEATURES = 'all_features';
const PAID_PLAN_TIERS = new Set(['pro', 'business', 'enterprise']);

const LOCKED_ANALYTICS_SETTINGS = Object.fromEntries(
  ANALYTICS_ID_KEYS.map((key) => [key, null])
) as MerchantWithAnalytics;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function hasGrowthIntegrationAccess(merchant: Record<string, unknown>) {
  const premiumFeatures = Array.isArray(merchant.premium_features)
    ? new Set(
        merchant.premium_features
          .filter((feature): feature is string => typeof feature === 'string')
          .map((feature) => feature.trim().toLowerCase())
          .filter(Boolean)
      )
    : new Set<string>();

  if (
    premiumFeatures.has(ALL_FEATURES) ||
    premiumFeatures.has('growth_integrations')
  ) {
    return true;
  }

  if (
    typeof merchant.plan_tier !== 'string' ||
    !PAID_PLAN_TIERS.has(merchant.plan_tier)
  ) {
    return false;
  }

  if (merchant.plan_expires_at === null) {
    return true;
  }

  if (typeof merchant.plan_expires_at !== 'string') {
    return false;
  }

  const expiryTime = Date.parse(merchant.plan_expires_at);
  return Number.isFinite(expiryTime) && expiryTime > Date.now();
}

export function buildMerchantAnalyticsSettings(
  source: unknown
): MerchantWithAnalytics | null {
  const merchant = asRecord(source);
  if (!merchant) {
    return null;
  }

  if (!hasGrowthIntegrationAccess(merchant)) {
    return { ...LOCKED_ANALYTICS_SETTINGS };
  }

  const featureSettings = asRecord(merchant.feature_settings);
  return Object.fromEntries(
    ANALYTICS_ID_KEYS.map((key) => [
      key,
      normalizeAnalyticsId(featureSettings?.[key]) ??
        (key === 'chatgpt_pixel_id'
          ? null
          : normalizeAnalyticsId(merchant[key])),
    ])
  ) as MerchantWithAnalytics;
}

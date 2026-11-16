import { normalizeCarrierProviderIds } from '@baci/shared/constants';
import { isPaystackCheckoutAvailable } from '@/lib/checkout/payment-gateway-availability';
import { isRepairsCatalogEnabled } from '@/lib/repairs/repairs-feature';

export interface StorefrontFeatures {
  loyaltyEnabled: boolean;
  reviewsEnabled: boolean;
  wishlistEnabled: boolean;
  orderTrackingEnabled: boolean;
  discountCodesEnabled: boolean;
  guestCheckoutEnabled: boolean;
  paystackEnabled: boolean;
  korapayEnabled: boolean;
  payOnDeliveryEnabled: boolean;
  creditDirectEnabled: boolean;
  credpalEnabled: boolean;
  klumpEnabled: boolean;
  creditDirectMinAmount: number;
  creditDirectMaxAmount: number;
  klumpMinAmount: number;
  klumpMaxAmount: number;
  preferredLocalGateway: 'paystack' | 'korapay';
  preferredInternationalGateway: 'paystack' | 'korapay';
  shippingProviders: string[];
  freeShippingThreshold: number | null;
  collectPhone: boolean;
  requireAccount: boolean;
  showOrderNotes: boolean;
  pages: {
    about: boolean;
    contact: boolean;
    faq: boolean;
    privacy: boolean;
    terms: boolean;
    rewards: boolean;
  };
  showRecentPurchases: boolean;
  showStockLevels: boolean;
  lowStockThreshold: number;
  hasGoogleAnalytics: boolean;
  hasFacebookPixel: boolean;
  hasTiktokPixel: boolean;
  vtuEnabled: boolean;
  vtuAirtimeEnabled: boolean;
  vtuDataEnabled: boolean;
  vtuCheckoutAddonEnabled: boolean;
  vtuCheckoutAddonAmounts: number[];
  vtuLoyaltyRewardEnabled: boolean;
  blogEnabled: boolean;
  autoBlogEnabled: boolean;
  repairsCatalogEnabled: boolean;
}

export type StorefrontFeaturesLookupResult =
  | {
      status: 200;
      merchantId: string;
      features: StorefrontFeatures;
      degraded: boolean;
    }
  | { status: 404 };

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNumberArray(value: unknown, fallback: number[]): number[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
  ) {
    return fallback;
  }

  return value;
}

function asGateway(
  value: unknown,
  fallback: 'paystack' | 'korapay'
): 'paystack' | 'korapay' {
  return value === 'paystack' || value === 'korapay' ? value : fallback;
}

function normalizePreferredGateway(
  gateway: 'paystack' | 'korapay',
  paystackEnabled: boolean
): 'paystack' | 'korapay' {
  return !paystackEnabled && gateway === 'paystack' ? 'korapay' : gateway;
}

export function buildPublicStorefrontFeatures({
  merchant,
  settings,
  paystackSubaccountConfigured,
}: {
  merchant: {
    id: string;
    country: string | null;
    business_type: string | null;
  };
  settings: Record<string, unknown>;
  paystackSubaccountConfigured: boolean;
}): StorefrontFeatures {
  const paystackEnabled = isPaystackCheckoutAvailable({
    country: merchant.country,
    paystack_subaccount_configured: paystackSubaccountConfigured,
    feature_settings: {
      paystack_enabled: asBoolean(settings.paystack_enabled, true),
    },
  });

  return {
    loyaltyEnabled: asBoolean(settings.loyalty_enabled, false),
    reviewsEnabled: asBoolean(settings.reviews_enabled, true),
    wishlistEnabled: asBoolean(settings.wishlist_enabled, true),
    orderTrackingEnabled: asBoolean(settings.order_tracking_enabled, true),
    discountCodesEnabled: asBoolean(settings.discount_codes_enabled, true),
    guestCheckoutEnabled: asBoolean(settings.guest_checkout_enabled, true),
    paystackEnabled,
    korapayEnabled: asBoolean(settings.korapay_enabled, false),
    payOnDeliveryEnabled: asBoolean(settings.pay_on_delivery_enabled, false),
    creditDirectEnabled: asBoolean(settings.credit_direct_enabled, false),
    credpalEnabled: false,
    klumpEnabled: asBoolean(settings.klump_enabled, false),
    creditDirectMinAmount: asNumber(settings.credit_direct_min_amount, 10000),
    creditDirectMaxAmount: asNumber(settings.credit_direct_max_amount, 500000),
    klumpMinAmount: asNumber(settings.klump_min_amount, 10000),
    klumpMaxAmount: asNumber(settings.klump_max_amount, 1000000),
    preferredLocalGateway: normalizePreferredGateway(
      asGateway(settings.preferred_local_gateway, 'paystack'),
      paystackEnabled
    ),
    preferredInternationalGateway: normalizePreferredGateway(
      asGateway(settings.preferred_international_gateway, 'korapay'),
      paystackEnabled
    ),
    shippingProviders: normalizeCarrierProviderIds(settings.shipping_providers),
    freeShippingThreshold: asNullableNumber(settings.free_shipping_threshold),
    collectPhone: asBoolean(settings.checkout_collect_phone, true),
    requireAccount: asBoolean(settings.checkout_require_account, false),
    showOrderNotes: asBoolean(settings.checkout_show_order_notes, true),
    pages: {
      about: asBoolean(settings.about_page_enabled, true),
      contact: asBoolean(settings.contact_page_enabled, true),
      faq: asBoolean(settings.faq_page_enabled, true),
      privacy: asBoolean(settings.privacy_page_enabled, true),
      terms: asBoolean(settings.terms_page_enabled, true),
      rewards: asBoolean(settings.rewards_page_enabled, false),
    },
    showRecentPurchases: asBoolean(settings.show_recent_purchases, false),
    showStockLevels: asBoolean(settings.show_stock_levels, true),
    lowStockThreshold: asNumber(settings.low_stock_threshold, 10),
    hasGoogleAnalytics: Boolean(settings.google_analytics_id),
    hasFacebookPixel: Boolean(settings.facebook_pixel_id),
    hasTiktokPixel: Boolean(settings.tiktok_pixel_id),
    vtuEnabled: asBoolean(settings.vtu_enabled, false),
    vtuAirtimeEnabled: asBoolean(settings.vtu_airtime_enabled, true),
    vtuDataEnabled: asBoolean(settings.vtu_data_enabled, true),
    vtuCheckoutAddonEnabled: asBoolean(
      settings.vtu_checkout_addon_enabled,
      false
    ),
    vtuCheckoutAddonAmounts: asNumberArray(
      settings.vtu_checkout_addon_amounts,
      [100, 200, 500, 1000]
    ),
    vtuLoyaltyRewardEnabled: asBoolean(
      settings.vtu_loyalty_reward_enabled,
      false
    ),
    blogEnabled: asBoolean(settings.blog_enabled, false),
    autoBlogEnabled: asBoolean(settings.auto_blog_enabled, false),
    repairsCatalogEnabled: isRepairsCatalogEnabled({
      businessType: merchant.business_type,
      repairsCatalogEnabled: asBoolean(settings.repairs_catalog_enabled, false),
    }),
  };
}

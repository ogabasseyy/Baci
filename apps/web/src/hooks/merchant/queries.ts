import type { SupabaseClient } from '@supabase/supabase-js';
import type { MerchantData } from './types';

type MerchantRow = Omit<MerchantData, 'feature_settings'> & {
  feature_settings?: unknown;
};

const PUBLIC_MERCHANT_SELECT = `
  id,
  business_name,
  business_type,
  email,
  phone,
  logo_url,
  brand_colors,
  country,
  payout_currency,
  pages,
  slug,
  published_config,
  favicon_svg_url,
  favicon_png_32_url,
  favicon_png_192_url,
  favicon_apple_touch_url,
  favicon_uploaded_at,
  social_media,
  support_email,
  support_phone,
  business_address,
  rider_phone_number,
  is_published,
  published_at,
  template_id,
  plan_tier,
  premium_features,
  hero_slides,
  mobile_hero_slides,
  feature_settings:merchant_feature_settings(id, merchant_id, loyalty_enabled, reviews_enabled, wishlist_enabled, order_tracking_enabled, discount_codes_enabled, guest_checkout_enabled, agentic_checkout_enabled, repairs_catalog_enabled, paystack_enabled, korapay_enabled, pay_on_delivery_enabled, credit_direct_enabled, credit_direct_public_key, credit_direct_min_amount, credit_direct_max_amount, credpal_enabled, klump_enabled, klump_min_amount, klump_max_amount, preferred_local_gateway, preferred_international_gateway, shipping_providers, free_shipping_threshold, shipping_markup_percentage, checkout_collect_phone, checkout_require_account, checkout_show_order_notes, about_page_enabled, contact_page_enabled, faq_page_enabled, privacy_page_enabled, terms_page_enabled, rewards_page_enabled, show_recent_purchases, show_stock_levels, low_stock_threshold, google_analytics_id, facebook_pixel_id, tiktok_pixel_id, snapchat_pixel_id, twitter_pixel_id, twitter_event_ids, chatgpt_pixel_id, auto_generate_schema, custom_robots_txt, email_notifications_enabled, sms_notifications_enabled, blog_enabled, auto_blog_enabled, google_reviews_enabled, google_place_id, vtu_enabled, vtu_airtime_enabled, vtu_data_enabled, vtu_electricity_enabled, vtu_tv_enabled, vtu_betting_enabled, vtu_checkout_addon_enabled, vtu_checkout_addon_amounts, vtu_loyalty_reward_enabled, vtu_merchant_commission_rate, vtu_customer_cashback_enabled, vtu_customer_cashback_rate, created_at, updated_at)
` as const;

/**
 * Normalize feature_settings from Supabase join.
 * Edge SQL may return an array instead of a single object.
 */
export function normalizeFeatureSettings(
  settings: unknown
): Record<string, unknown> | undefined {
  if (Array.isArray(settings)) return settings[0] as Record<string, unknown>;
  return settings as Record<string, unknown> | undefined;
}

function normalizeMerchantRow(merchant: MerchantRow | null | undefined) {
  if (!merchant) {
    return null;
  }

  return {
    ...merchant,
    feature_settings: normalizeFeatureSettings(merchant.feature_settings),
  } as MerchantData;
}

/**
 * Fetch merchant data by storefront slug.
 */
export async function fetchMerchantBySlug(
  supabase: SupabaseClient,
  slug: string
): Promise<MerchantData | null> {
  const { data, error } = await supabase
    .from('merchants')
    .select(PUBLIC_MERCHANT_SELECT)
    .eq('slug', slug)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return normalizeMerchantRow(data as MerchantRow | null);
}

/**
 * Fetch the primary custom domain for a merchant.
 */
export async function fetchPrimaryDomain(
  supabase: SupabaseClient,
  merchantId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('domains')
    .select('domain')
    .eq('merchant_id', merchantId)
    .eq('is_primary', true)
    .eq('status', 'active')
    .maybeSingle();

  return data?.domain ?? null;
}

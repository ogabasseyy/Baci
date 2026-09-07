import type { RegisteredAddress } from '@baci/shared';
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { cacheLife, cacheTag } from 'next/cache';
import { cache } from 'react';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { getSupabaseServiceRoleKey, getSupabaseUrl } from '@/env';
import { getBlogCacheTag } from '@/lib/blog-cache-tags';
import { BLOG_LISTING_PAGE_SIZE } from '@/lib/blog-listing-page-size';
import type {
  CachedCategoryRecord,
  CachedCategorySeo,
} from '@/lib/cached-category-page-shell-types';
import {
  type CachedCategoryPageProductScope,
  categoryPageProductIdCache,
} from '@/lib/category-page-product-id-cache';
import { getCategoryPageShellData } from '@/lib/get-category-page-shell-data';
import { hydrateAndSanitizePublicProducts } from '@/lib/hydrate-public-products';
import { isPostgrestNoRowsError } from '@/lib/is-postgrest-no-rows-error';
import { merchantFeatureSettingsDefaults } from '@/lib/merchant-feature-settings-defaults';
import { normalizeStorefrontCategoryValue } from '@/lib/normalize-storefront-category-value';
import { getOrderedBlogPostProductLinks } from '@/lib/ordered-blog-post-product-links';
import { getProductScopedCacheTag } from '@/lib/product-cache-tags';
import { PRODUCT_KEY_SPECS_RELATION_SELECT } from '@/lib/product-key-specs-select';
import type { Product } from '@/lib/products';
import {
  filterPublicBlogCategories,
  filterPublicBlogPosts,
  isPublicBlogPost,
} from '@/lib/public-blog-content-quality';
import { applyPublicBlogSqlFilters } from '@/lib/public-blog-sql-filters';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';
import {
  normalizeRelatedBlogProductLinks,
  normalizeRelatedBlogProducts,
  RELATED_BLOG_PRODUCTS_SELECT,
} from '@/lib/related-blog-products';
import { selectSemanticRelatedBlogPosts } from '@/lib/semantic-related-blog-posts';
import { generateSlug } from '@/lib/seo-utils';
import { normalizeOgabasseyBusinessType } from '@/lib/storefront/ogabassey-entity';
import { STOREFRONT_BLOG_POST_SELECT } from '@/lib/storefront-blog-post-select';
import { canonicalizeStorefrontMediaUrl } from '@/lib/storefront-media-cdn-url';
import { readStorefrontMerchantSnapshot } from '@/lib/storefront-merchant-snapshot';
import { readStorefrontPdpCoreSnapshot } from '@/lib/storefront-pdp-core-snapshot';
import {
  StorefrontReadUnavailableError,
  unwrapStorefrontReadResultForCache,
} from '@/lib/storefront-read-result';
import type { VariantAttributeSource } from '@/lib/storefront-specs/variant-attributes';
import { createTimeoutComposedFetch } from '@/lib/supabase/compose-fetch-signal';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';
import type { MerchantAboutPage } from '@/types/about-page';
import type {
  StorefrontDatabase,
  StorefrontMerchantSnapshotRow,
} from '@/types/storefront-database';
import type { MerchantTrustProfileDraft } from '../../../../packages/shared/src/contracts/merchant-trust-profile';
import { sanitizePublicProduct } from './public-fulfillment-sanitizer';

export { getCachedCategoryPageShellData } from '@/lib/cached-category-page-shell';
export { getPublicSupabaseClient };

// Supabase/PostgREST `estimated` keeps small public blog counts exact while
// avoiding full COUNT scans when stale route regeneration hits large merchant
// blog catalogs. These pages tolerate planner-estimated pagination for large
// result sets better than production 500s from exact COUNT pressure.
const PUBLIC_BLOG_COUNT_OPTIONS = { count: 'estimated' as const };

const RELATED_BLOG_POSTS_LIMIT = 3;
const RELATED_BLOG_POSTS_FETCH_LIMIT = 36;
const RELATED_BLOG_CATEGORY_FETCH_LIMIT = 24;

const RELATED_BLOG_POST_SELECT =
  'id, title, slug, excerpt, featured_image_url, category, tags, keywords, published_at, reading_time_minutes';

function getEstimatedPaginationCountFloor({
  count,
  itemCount,
  limit,
  page,
}: {
  count: number | null | undefined;
  itemCount: number;
  limit: number;
  page: number;
}): number {
  const countValue = count ?? 0;
  const currentPageFloor = itemCount > 0 ? (page - 1) * limit + itemCount : 0;

  return Math.max(countValue, currentPageFloor);
}
interface RelatedBlogPostIdentity {
  id?: string | null;
  slug?: string | null;
}

function combineUniqueRelatedBlogPosts<T extends RelatedBlogPostIdentity>(
  ...postGroups: Array<T[] | null | undefined>
): T[] {
  const seenKeys = new Set<string>();
  const uniquePosts: T[] = [];

  for (const postGroup of postGroups) {
    for (const post of postGroup || []) {
      const key = post.id || post.slug;
      if (key && seenKeys.has(key)) {
        continue;
      }

      if (key) {
        seenKeys.add(key);
      }
      uniquePosts.push(post);
    }
  }

  return uniquePosts;
}

/** Default transport bound for cached-data Supabase clients. */
const CACHED_CLIENT_DEFAULT_TIMEOUT_MS = 10_000;

function getStorefrontSnapshotSupabaseClient(): SupabaseClient<StorefrontDatabase> {
  // The runtime client is the same anonymous public client used by the rest of
  // cached-data. This narrow generated-schema cast makes only the snapshot RPC
  // boundary aware of migrations that are not live when types are generated.
  return getPublicSupabaseClient() as unknown as SupabaseClient<StorefrontDatabase>;
}

/**
 * Hydrates product list with public serialized variant summaries and sanitizes them.
 */
export async function hydrateAndSanitizeProducts<T extends { id: string }>(
  supabase: SupabaseClient,
  merchantId: string,
  products: T[]
): Promise<T[]> {
  return await hydrateAndSanitizePublicProducts(supabase, merchantId, products);
}

interface PublicStorefrontProductVariant {
  attributes: Record<string, string> | null;
  condition?: string | null;
  created_at?: string | null;
  id: string;
  images?: unknown;
  price_override?: number | string | null;
  primary_image?: string | null;
  product_id: string;
  sku?: string | null;
  stock_quantity?: number | null;
  updated_at?: string | null;
}

interface LegacyPriceCompatibleProduct {
  price?: number | string | null;
  compare_at_price?: number | string | null;
  sale_price?: number | null;
  base_price?: number | null;
}

export type CachedCategoryPageData =
  | {
      category?: null;
      description: string;
      fallbackDescription?: string;
      fallbackName?: string;
      isCollection: true;
      isInactiveCategory?: false;
      name: string;
      productIdsQueryFailed?: boolean;
      productCount?: number;
      productsArePrePaginated?: boolean;
      products: unknown[];
      productSlots?: unknown[];
      productsQueryFailed?: boolean;
      seo: CachedCategorySeo;
    }
  | {
      category: CachedCategoryRecord | null;
      fallbackDescription: string;
      fallbackName: string;
      isCollection: false;
      isInactiveCategory: boolean;
      name?: string;
      productIdsQueryFailed?: boolean;
      productCount?: number;
      productsArePrePaginated?: boolean;
      products: unknown[];
      productSlots?: unknown[];
      // True when the products fallback query errored (vs a genuinely empty
      // result) — consumers must fail open instead of 404ing.
      productsQueryFailed?: boolean;
      // True when the category `.single()` lookup hit a transient error (not a
      // normal "no rows") — consumers must also fail open on this.
      categoryQueryFailed?: boolean;
      seo?: null;
    };

function parsePriceValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function withLegacyPriceFields<T extends LegacyPriceCompatibleProduct>(
  product: T
): T & { base_price: number; sale_price: number | null } {
  const currentPrice = parsePriceValue(product.price);
  const compareAtPrice = parsePriceValue(product.compare_at_price);
  const hasSale =
    currentPrice !== null &&
    compareAtPrice !== null &&
    compareAtPrice > currentPrice;

  const basePrice = hasSale
    ? compareAtPrice
    : (currentPrice ?? compareAtPrice ?? 0);
  const salePrice = hasSale ? currentPrice : null;

  return {
    ...product,
    base_price: basePrice,
    sale_price: salePrice,
  };
}

async function getCachedPublicProductVariantsByProductIds(
  merchantId: string,
  productIds: string[]
) {
  'use cache';
  cacheLife('products');
  cacheTag('products', 'product-variants', `products-${merchantId}`);

  const uniqueProductIds = Array.from(
    new Set(productIds.filter((id): id is string => Boolean(id)))
  );

  if (uniqueProductIds.length === 0) {
    return {} as Record<string, PublicStorefrontProductVariant[]>;
  }

  const supabase = getPublicSupabaseClient();
  const { data, error } = await supabase.rpc(
    'get_storefront_product_variants',
    {
      p_product_ids: uniqueProductIds,
    }
  );

  if (error) {
    throw error;
  }

  const variantsByProductId: Record<string, PublicStorefrontProductVariant[]> =
    {};

  for (const variant of (data || []) as PublicStorefrontProductVariant[]) {
    if (!variantsByProductId[variant.product_id]) {
      variantsByProductId[variant.product_id] = [];
    }

    variantsByProductId[variant.product_id].push(variant);
  }

  return variantsByProductId;
}

async function getPublicProductVariantsByProductIds(
  merchantId: string,
  productIds: string[]
) {
  return await getCachedPublicProductVariantsByProductIds(
    merchantId,
    productIds
  );
}

// Type for merchant data with optional custom_domain
export interface HeroSlide {
  id: string;
  imageUrl: string;
  headline: string;
  description: string;
  cta: string;
}

export interface MerchantFeatureSettings {
  agentic_checkout_enabled?: boolean;
  blog_enabled?: boolean;
  blog_discover_image_validation_enabled?: boolean;
  facebook_pixel_id?: string | null;
  repairs_catalog_enabled?: boolean;
  shipping_insurance_enabled?: boolean;
  shipping_insurance_min_order_value?: number;
  shipping_insurance_opt_in_default?: boolean;
  [key: string]: unknown;
}

const MERCHANT_PUBLIC_FEATURE_SETTINGS_SELECT: string = `
  about_page_enabled,
  agentic_checkout_enabled,
  auto_blog_enabled,
  blog_enabled,
  blog_discover_image_validation_enabled,
  checkout_collect_phone,
  checkout_require_account,
  checkout_show_order_notes,
  contact_page_enabled,
  credpal_enabled,
  credit_direct_enabled,
  credit_direct_max_amount,
  credit_direct_min_amount,
  custom_settings,
  discount_codes_enabled,
  faq_page_enabled,
  facebook_pixel_id,
  free_shipping_threshold,
  google_analytics_id,
  google_place_id,
  google_reviews_enabled,
  guest_checkout_enabled,
  juicyway_enabled,
  klump_enabled,
  klump_max_amount,
  klump_min_amount,
  korapay_enabled,
  loyalty_enabled,
  low_stock_threshold,
  order_tracking_enabled,
  pay_on_delivery_enabled,
  paystack_enabled,
  preferred_international_gateway,
  preferred_local_gateway,
  privacy_page_enabled,
  repairs_catalog_enabled,
  reviews_enabled,
  rewards_page_enabled,
  shipping_insurance_enabled,
  shipping_insurance_min_order_value,
  shipping_insurance_opt_in_default,
  shipping_providers,
  show_recent_purchases,
  show_stock_levels,
  snapchat_pixel_id,
  terms_page_enabled,
  tiktok_pixel_id,
  twitter_pixel_id,
  vtu_airtime_enabled,
  vtu_checkout_addon_amounts,
  vtu_checkout_addon_enabled,
  vtu_data_enabled,
  vtu_electricity_enabled,
  vtu_enabled,
  vtu_loyalty_reward_enabled,
  vtu_tv_enabled,
  wallet_order_auto_debit_enabled,
  wallet_paystack_dva_enabled,
  customer_device_savings_enabled,
  customer_device_savings_auto_debit_enabled,
  customer_device_savings_break_fee_enabled,
  wishlist_enabled
`;

const MERCHANT_PUBLIC_FEATURE_SETTINGS_LEGACY_SELECT =
  MERCHANT_PUBLIC_FEATURE_SETTINGS_SELECT.replace(
    /^\s*repairs_catalog_enabled,\n/m,
    ''
  );

export interface CachedMerchant {
  id: string;
  business_name: string;
  site_title: string;
  site_tagline: string;
  site_description: string;
  business_type: string;
  logo_url: string;
  phone: string;
  email: string;
  support_email?: string | null;
  support_phone?: string | null;
  social_media?: {
    twitter?: string;
    facebook?: string;
    instagram?: string;
    tiktok?: string;
    youtube?: string;
    pinterest?: string;
    linkedin?: string;
    snapchat?: string;
  };
  brand_colors?: {
    primary: string;
    secondary?: string;
    accent: string;
    background: string;
  };
  slug: string;
  business_address: string;
  legal_entity_name?: string | null;
  registered_address?: RegisteredAddress | null;
  tax_identification_number?: string | null;
  trust_profile?: MerchantTrustProfileDraft | null;
  payout_currency: string;
  paystack_subaccount_code?: string | null;
  /**
   * Derived capability hints from the public merchant snapshot. Presentation
   * only — private payment/order paths stay authoritative. Raw payment/plan
   * fields never cross the anonymous RPC boundary.
   */
  paystack_subaccount_configured?: boolean;
  price_negotiation_enabled?: boolean;
  is_published: boolean;
  template_id: string;
  plan_expires_at?: string | null;
  plan_tier: string;
  premium_features: unknown;
  custom_domain?: string;
  country?: string;
  hero_slides?: HeroSlide[];
  mobile_hero_slides?: HeroSlide[];
  // Favicon properties
  favicon_svg_url?: string;
  favicon_png_32_url?: string;
  favicon_apple_touch_url?: string;
  // VAT settings
  vat_registration_status?:
    | 'not_registered'
    | 'registered'
    | 'exempt'
    | 'pending';
  vat_rate?: number;
  feature_settings?: MerchantFeatureSettings;
  published_config?: Record<string, unknown> | null;
  // Legacy content pages (JSONB — used by contact, terms, privacy, faq, about pages)
  pages?: {
    contact?: string;
    terms?: string;
    privacy?: string;
    faq?: string;
    about?: string;
  };
  // Structured about page data — extends MerchantAboutPage with the
  // headline/image_url fields used by template-specific About pages
  // (e.g. Ogabassey hero) which aren't part of the canonical schema.
  about_page?: MerchantAboutPage & {
    headline?: string;
    image_url?: string;
  };
  // FAQ items array
  faq_items?: Array<{ question: string; answer: string }>;
  // Last update timestamp
  updated_at?: string;
}

type CachedMerchantMediaFields = {
  custom_domain?: string | null;
  favicon_apple_touch_url?: string | null;
  favicon_png_32_url?: string | null;
  favicon_svg_url?: string | null;
  id?: string | null;
  logo_url?: string | null;
  slug?: string | null;
};

function isOgabasseyMerchantEntity(merchant: CachedMerchantMediaFields) {
  const customDomain = merchant.custom_domain?.toLowerCase();
  const slug = merchant.slug?.toLowerCase();

  return (
    merchant.id === OGABASSEY_MERCHANT_ID ||
    customDomain === 'ogabassey.com' ||
    slug === 'ogabassey'
  );
}

function canonicalizeMerchantMediaUrl(value: string | null | undefined) {
  if (!value) {
    return value;
  }

  return canonicalizeStorefrontMediaUrl(value) ?? value;
}

function withStorefrontMediaCdnUrls<T extends CachedMerchantMediaFields>(
  merchant: T
): T {
  if (!isOgabasseyMerchantEntity(merchant)) {
    return merchant;
  }

  return {
    ...merchant,
    favicon_apple_touch_url: canonicalizeMerchantMediaUrl(
      merchant.favicon_apple_touch_url
    ),
    favicon_png_32_url: canonicalizeMerchantMediaUrl(
      merchant.favicon_png_32_url
    ),
    favicon_svg_url: canonicalizeMerchantMediaUrl(merchant.favicon_svg_url),
    logo_url: canonicalizeMerchantMediaUrl(merchant.logo_url),
  } as T;
}

function normalizeCachedMerchantEntity<
  T extends {
    business_type?: string | null;
    custom_domain?: string | null;
    favicon_apple_touch_url?: string | null;
    favicon_png_32_url?: string | null;
    favicon_svg_url?: string | null;
    id?: string | null;
    logo_url?: string | null;
    slug?: string | null;
    template_id?: string | null;
  },
>(merchant: T): Omit<T, 'business_type'> & { business_type: string } {
  const merchantWithCdnMedia = withStorefrontMediaCdnUrls(merchant);

  return {
    ...merchantWithCdnMedia,
    business_type: normalizeOgabasseyBusinessType(merchantWithCdnMedia),
  };
}

function redactUnpublishedMerchantContactFields<
  T extends {
    business_address?: unknown;
    email?: unknown;
    is_published?: boolean | null;
    legal_entity_name?: unknown;
    phone?: unknown;
    registered_address?: unknown;
    support_email?: unknown;
    support_phone?: unknown;
    tax_identification_number?: unknown;
    trust_profile?: unknown;
  },
>(merchant: T): T {
  if (merchant.is_published) return merchant;

  merchant.email = '';
  merchant.phone = '';
  merchant.support_email = '';
  merchant.support_phone = '';
  merchant.business_address = '';
  merchant.legal_entity_name = null;
  merchant.registered_address = null;
  merchant.tax_identification_number = null;
  merchant.trust_profile = null;
  return merchant;
}

function normalizeResolvedStorefrontCachedMerchantRow(
  row: StorefrontMerchantSnapshotRow
): CachedMerchant | null {
  if (
    !row.merchant_data ||
    typeof row.merchant_data !== 'object' ||
    Array.isArray(row.merchant_data)
  ) {
    return null;
  }

  const merchant = row.merchant_data as unknown as CachedMerchant;
  if (typeof merchant.id !== 'string' || typeof merchant.slug !== 'string') {
    return null;
  }
  redactUnpublishedMerchantContactFields(merchant);

  const featureSettings =
    row.feature_settings &&
    typeof row.feature_settings === 'object' &&
    !Array.isArray(row.feature_settings)
      ? (row.feature_settings as MerchantFeatureSettings)
      : (merchantFeatureSettingsDefaults.buildPublicDefault(
          merchant.id
        ) as MerchantFeatureSettings);

  return {
    ...normalizeCachedMerchantEntity({
      ...merchant,
      custom_domain: row.custom_domain ?? undefined,
    }),
    feature_settings: featureSettings,
  };
}

async function getCachedStorefrontMerchantSnapshot(
  identifier: string
): Promise<CachedMerchant | null> {
  'use cache';
  cacheLife('merchant');
  cacheTag(
    'merchants',
    'domains',
    `merchant-${identifier}`,
    `domain-${identifier}`
  );

  const row = unwrapStorefrontReadResultForCache(
    await readStorefrontMerchantSnapshot(
      getStorefrontSnapshotSupabaseClient(),
      identifier
    )
  );
  if (!row) return null;

  const merchant = normalizeResolvedStorefrontCachedMerchantRow(row);
  if (!merchant) {
    throw new StorefrontReadUnavailableError({
      kind: 'integrity',
      operation: 'merchant_snapshot',
      retryable: false,
    });
  }

  cacheTag(
    `features-${merchant.id}`,
    `merchant-${merchant.slug}`,
    ...(merchant.custom_domain
      ? [`domain-${merchant.custom_domain.toLowerCase()}`]
      : [])
  );
  return merchant;
}

function summarizeStorefrontSnapshotError(error: unknown) {
  if (error instanceof StorefrontReadUnavailableError) {
    return error.failure;
  }
  return {
    kind: 'unexpected',
    name:
      error instanceof Error
        ? sanitizeLookupLogValue(error.name)
        : 'UnknownError',
  };
}

/**
 * Cached merchant data by slug.
 * Keep this hot storefront shell lookup in the local Cache Components cache.
 * The official Next guidance calls out remote cache network-latency tradeoffs,
 * and live Vercel logs showed RemoteCacheHandler 408/502 failures here.
 */
export async function getCachedMerchant(
  slug: string
): Promise<CachedMerchant | null> {
  'use cache';
  cacheLife('merchant');
  const normalizedSlug = slug.toLowerCase();
  cacheTag('merchants', `merchant-${normalizedSlug}`);

  let merchant: CachedMerchant | null;
  try {
    merchant = await getCachedStorefrontMerchantSnapshot(normalizedSlug);
  } catch (error) {
    const safeSlug = sanitizeLookupLogValue(slug);
    console.error('Error fetching merchant for slug:', safeSlug, {
      error: summarizeStorefrontSnapshotError(error),
    });
    throw error;
  }

  if (!merchant) {
    const safeSlug = sanitizeLookupLogValue(slug);
    console.warn('No merchant data found for slug:', safeSlug);
    return null;
  }

  console.log(
    'Successfully fetched merchant:',
    sanitizeLookupLogValue(slug),
    merchant.id
  );
  cacheTag(`features-${merchant.id}`);
  return merchant;
}

/**
 * Cached merchant data by custom domain.
 * Normalizes the domain to lowercase before lookup.
 * Keep this hot storefront shell lookup in the local Cache Components cache;
 * remote cache handler failures should not be able to break merchant routing.
 */
export async function getCachedMerchantByDomain(
  domain: string
): Promise<CachedMerchant | null> {
  'use cache';
  cacheLife('merchant');
  const normalizedDomain = domain.toLowerCase();
  const safeDomain = sanitizeLookupLogValue(normalizedDomain);
  cacheTag('merchants', 'domains', `domain-${normalizedDomain}`);

  let resolvedMerchant: CachedMerchant | null;
  try {
    resolvedMerchant =
      await getCachedStorefrontMerchantSnapshot(normalizedDomain);
  } catch (error) {
    console.error('Error resolving merchant for domain', {
      domain: safeDomain,
      error: summarizeStorefrontSnapshotError(error),
    });
    throw error;
  }

  if (!resolvedMerchant) {
    console.warn('No domain mapping found for:', safeDomain);
    return null;
  }

  console.log('Successfully fetched merchant by domain', {
    domain: safeDomain,
    slug: resolvedMerchant.slug,
    merchantId: resolvedMerchant.id,
  });

  cacheTag(`features-${resolvedMerchant.id}`);
  return resolvedMerchant;
}

export function sanitizeLookupLogValue(value: unknown): string {
  return String(value || '')
    .replace(/[\r\n\t]/g, '')
    .substring(0, 100);
}

/**
 * Get merchant by identifier (slug or custom domain)
 * Automatically detects whether the identifier is a domain or slug
 */
export async function getMerchantByIdentifier(
  identifier: string
): Promise<CachedMerchant | null> {
  if (!isValidMerchantIdentifier(identifier)) return null;

  if (isDomainIdentifier(identifier)) {
    return await getCachedMerchantByDomain(identifier.toLowerCase());
  }
  return await getCachedMerchant(identifier.toLowerCase());
}

/**
 * Merchant-shell lookup. The public snapshot runs as an idempotent GET under
 * one total deadline, leaving retry ownership to the Supabase/PostgREST client.
 * Only an explicit database not-found status becomes null; failures throw
 * instead of becoming crawlable storefront 404s.
 */
export async function getMerchantSafe(
  identifier: string
): Promise<CachedMerchant | null> {
  return await getMerchantByIdentifier(identifier);
}

/**
 * Strict merchant lookup — throws on transient failures.
 * Use inside cached functions where returning null on a transient error would
 * cache the failure instead of letting the caller retry on a later render.
 * A genuine "merchant not found" still returns null (safe to cache).
 */
export async function getMerchantStrict(
  identifier: string
): Promise<CachedMerchant | null> {
  return await getMerchantByIdentifier(identifier);
}

/**
 * Request-scoped merchant lookup via React cache().
 * Deduplicates getMerchantSafe() calls within a single request — if both
 * layout.tsx and page.tsx call this with the same identifier, only one
 * actual fetch happens. The second call reuses the same Promise.
 */
export const getRequestScopedMerchant = cache(
  (identifier: string): Promise<CachedMerchant | null> => {
    return getMerchantSafe(identifier);
  }
);

/**
 * Request-scoped blog post lookup via React cache().
 * Deduplicates getCachedBlogPost() calls within a single request — the blog
 * post route's generateMetadata, hero-shell static-shell lookup, and streamed
 * body resolver all resolve the same post; only one lookup runs per unique
 * (identifier, postSlug, includeDrafts) argument tuple.
 *
 * `includeDrafts` has no default here on purpose: React's cache() keys on
 * `arguments.length` as well as argument values, so a caller that omits it
 * would silently miss every other call site's cache entry instead of sharing
 * it. Every call site must pass it explicitly.
 */
export const getRequestScopedBlogPost = cache(
  (
    identifier: string,
    postSlug: string,
    includeDrafts: boolean
  ): ReturnType<typeof getCachedBlogPost> => {
    return getCachedBlogPost(identifier, postSlug, includeDrafts);
  }
);

/**
 * Cached merchant data by ID
 */
export async function getCachedMerchantById(
  merchantId: string
): Promise<CachedMerchant | null> {
  // PR4a: local `'use cache'`, not the framework remote handler. Primary-key
  // .single() (<5ms), ~75 keys, tiny row — no cross-instance sharing need, and
  // the remote SET is the exit-128 write hazard. Consumed only by background
  // repair notifications, both of which already `.catch(() => null)`.
  'use cache';
  cacheLife('merchant');
  cacheTag('merchants', `merchant-id-${merchantId}`);

  const supabase = getPublicSupabaseClient();

  const { data, error } = await supabase
    .from('merchants')
    .select(`
        id,
        business_name,
        site_title,
        site_tagline,
        site_description,
        business_type,
        logo_url,
        phone,
        email,
        social_media,
        brand_colors,
        slug,
        business_address,
        payout_currency,
        is_published,
        template_id,
        plan_expires_at,
        plan_tier,
        premium_features,
        country,
        hero_slides,
        favicon_svg_url,
        favicon_png_32_url,
        favicon_apple_touch_url,
        vat_registration_status,
        vat_rate
      `)
    .eq('id', merchantId)
    .single();

  if (error) {
    // A genuine "no rows" is real absence (this merchant id does not exist);
    // any other error is transient/authoritative and must fail loud so the
    // cache never persists null-as-absence for a merchant that does exist.
    if (isPostgrestNoRowsError(error)) {
      return null;
    }
    console.error('Error fetching merchant by ID:', error);
    throw error;
  }

  return normalizeCachedMerchantEntity(data);
}

/**
 * Hard cap on the hydrated product rows a single `getCachedProducts` call can
 * materialize. On origin/main this reader had NO default limit, so a
 * full-catalog request (ogabassey has ~1,333 active products) hydrated 100s of
 * rich rows into one cache item. The only consumer is the authed FAQ sample
 * (limit 10); this cap keeps the (now local) cache payload bounded as catalogs
 * grow and clamps any oversized explicit limit.
 */
const GET_CACHED_PRODUCTS_MAX_ROWS = 100;

/**
 * Window size for an offset-only call (`offset` without `limit`). Carried over
 * from the pre-existing `range(offset, offset + 20 - 1)` behaviour on
 * origin/main — kept as its own constant because it is a paging default, not a
 * payload bound, so it must not drift with GET_CACHED_PRODUCTS_MAX_ROWS.
 */
const GET_CACHED_PRODUCTS_OFFSET_WINDOW = 20;

/**
 * Cached products for a merchant.
 * Uses 'products' cacheLife profile (stale 5min, revalidate 5min, expire 24hr)
 *
 * Note: Returns product_categories as an array with nested categories objects.
 * Consumers should extract the first category like:
 * `product.product_categories?.[0]?.categories` to get { id, name, slug }
 */
export async function getCachedProducts(
  merchantId: string,
  options?: {
    limit?: number;
    offset?: number;
    categoryId?: string;
    includeVariants?: boolean;
    /** Deprecated: the products table no longer has an is_featured column. */
    featured?: boolean;
  }
) {
  // PR4b review round 4: stays `'use cache: remote'` (demotion REVERTED).
  // `revalidateProducts()` busts `products-${merchantId}` on every product
  // create/update/delete, so this entry's freshness contract depends on tag
  // propagation — and a tag bust handled on one instance never clears a LOCAL
  // entry on the others. The payload cap below (the real exit-128 mitigation)
  // is retained and matters MORE on the shared store, where an oversized item
  // is what fails the remote write.
  'use cache: remote';
  cacheLife('products');
  cacheTag('products', `products-${merchantId}`);

  const supabase = getPublicSupabaseClient();

  let query = supabase
    .from('products')
    .select(`
        id,
        name,
        description,
        slug,
        canonical_url,
        price,
        compare_at_price,
        status,
        is_parent,
        quantity:stock_quantity,
        track_quantity:manage_stock,
        images,
        color_images,
        brand,
        condition,
        product_categories (
          category_id,
          categories (
            id,
            name,
            slug
          )
        )
      `)
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .or('is_parent.eq.true,parent_product_id.is.null') // Only show parent products or standalone products
    .order('created_at', { ascending: false });

  if (options?.categoryId) {
    query = query.eq('product_categories.category_id', options.categoryId);
  }

  const cappedLimit = options?.limit
    ? Math.min(options.limit, GET_CACHED_PRODUCTS_MAX_ROWS)
    : undefined;

  if (cappedLimit) {
    query = query.limit(cappedLimit);
  }

  if (options?.offset) {
    query = query.range(
      options.offset,
      options.offset + (cappedLimit ?? GET_CACHED_PRODUCTS_OFFSET_WINDOW) - 1
    );
  }

  // No explicit window: hard-cap the hydrated payload so a full-catalog read
  // can never be written to the cache as one unbounded item.
  if (!cappedLimit && !options?.offset) {
    query = query.limit(GET_CACHED_PRODUCTS_MAX_ROWS);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching products:', error);
    throw error;
  }

  const products = (data || []).map(withLegacyPriceFields);
  const variantsByProductId =
    options?.includeVariants === false
      ? {}
      : await getPublicProductVariantsByProductIds(
          merchantId,
          products.map((product) => product.id)
        );

  const rawProducts = products.map((product) => ({
    ...product,
    product_variants: variantsByProductId[product.id] || [],
  }));

  return hydrateAndSanitizeProducts(supabase, merchantId, rawProducts);
}

/**
 * Product fields required before the full PDP stream can render.
 * Keep this shape narrow so the LCP image hint is not delayed by rich product joins.
 */
export interface CachedProductLcpHint {
  base_price?: number | null;
  brand?: string | null;
  canonical_url?: string | null;
  category?: string | null;
  categories?:
    | {
        id: string;
        name: string;
        slug: string;
      }
    | Array<{
        id: string;
        name: string;
        slug: string;
      }>
    | null;
  color?: string | null;
  condition?: string | null;
  compare_at_price?: number | string | null;
  default_variant_id?: string | null;
  has_variants?: boolean | null;
  id: string;
  images?: Array<
    | string
    | {
        alt?: string | null;
        url: string;
      }
  > | null;
  keywords?: string[] | null;
  manage_stock?: boolean | null;
  max_variant_price?: number | string | null;
  merchant_id?: string | null;
  meta_description?: string | null;
  meta_title?: string | null;
  min_variant_price?: number | string | null;
  name: string;
  price?: number | string | null;
  product_categories?: Array<{
    categories:
      | {
          id: string;
          name: string;
          slug: string;
        }
      | Array<{
          id: string;
          name: string;
          slug: string;
        }>
      | null;
  }> | null;
  product_offers?: CachedStorefrontProductOffer[];
  product_variants?: PublicStorefrontProductVariant[] | null;
  sale_price?: number | null;
  schema_markup?: unknown;
  slug?: string | null;
  stock?: number | null;
  stock_quantity?: number | null;
  updated_at?: string | null;
  variant_attributes?: unknown;
}

interface CachedProductLcpHintOptions {
  includeVariants?: boolean;
}

interface CachedStorefrontProductOffer {
  condition: NonNullable<Product['condition']>;
  id: string;
  images?: string[];
  price: number | string | null;
  status: string;
  stock_quantity?: number | string | null;
}

type CachedStorefrontProductImage =
  | string
  | { alt?: string; order?: number; url: string };

type CachedStorefrontPdpCore = Omit<
  CachedProductLcpHint,
  | 'brand'
  | 'category'
  | 'compare_at_price'
  | 'condition'
  | 'images'
  | 'max_variant_price'
  | 'merchant_id'
  | 'min_variant_price'
  | 'price'
  | 'product_categories'
  | 'product_variants'
  | 'schema_markup'
  | 'slug'
  | 'variant_attributes'
> & {
  brand?: string;
  category?: string;
  compare_at_price?: number;
  condition?: string;
  has_condition_offers?: boolean;
  images?: CachedStorefrontProductImage[];
  max_variant_price?: number;
  merchant_id?: string;
  min_variant_price?: number;
  offers: CachedStorefrontProductOffer[];
  price: number;
  product_key_specs?: unknown;
  product_categories?: Array<{
    categories: { id: string; name: string; slug: string } | null;
  }>;
  product_offers: CachedStorefrontProductOffer[];
  product_variants: PublicStorefrontProductVariant[];
  schema_markup?: Product['schema_markup'];
  slug: string;
  specifications?: Product['specifications'];
  status?: string;
  variant_attributes?: VariantAttributeSource;
  variant_model?: 'legacy' | 'sku_matrix' | null;
  [key: string]: unknown;
};
type CachedStorefrontPdpSnapshot =
  | { kind: 'product'; product: CachedStorefrontPdpCore }
  | { kind: 'redirect'; target: CachedLegacyProductRedirectTarget };

function normalizeCachedStorefrontPdpCore(
  product: Record<string, unknown>
): CachedStorefrontPdpCore | null {
  const id = typeof product.id === 'string' ? product.id : null;
  const name = typeof product.name === 'string' ? product.name : null;
  const storedSlug = typeof product.slug === 'string' ? product.slug : null;
  const price =
    typeof product.price === 'number' && Number.isFinite(product.price)
      ? product.price
      : null;
  if (!id || !name || price === null) return null;
  const slug = storedSlug || id;

  const productOffers = Array.isArray(product.product_offers)
    ? (product.product_offers as CachedStorefrontProductOffer[])
    : [];
  const images = Array.isArray(product.images)
    ? product.images.flatMap((image): CachedStorefrontProductImage[] => {
        if (typeof image === 'string') return [image];
        if (!image || typeof image !== 'object') return [];
        const url = Reflect.get(image, 'url');
        if (typeof url !== 'string') return [];
        const alt = Reflect.get(image, 'alt');
        const order = Reflect.get(image, 'order');
        return [
          {
            url,
            ...(typeof alt === 'string' ? { alt } : null),
            ...(typeof order === 'number' ? { order } : null),
          },
        ];
      })
    : undefined;

  return {
    ...product,
    id,
    name,
    slug,
    price,
    brand: typeof product.brand === 'string' ? product.brand : undefined,
    category:
      typeof product.category === 'string' ? product.category : undefined,
    compare_at_price:
      typeof product.compare_at_price === 'number'
        ? product.compare_at_price
        : undefined,
    condition:
      typeof product.condition === 'string' ? product.condition : undefined,
    has_condition_offers:
      typeof product.has_condition_offers === 'boolean'
        ? product.has_condition_offers
        : undefined,
    images,
    max_variant_price:
      typeof product.max_variant_price === 'number'
        ? product.max_variant_price
        : undefined,
    merchant_id:
      typeof product.merchant_id === 'string' ? product.merchant_id : undefined,
    min_variant_price:
      typeof product.min_variant_price === 'number'
        ? product.min_variant_price
        : undefined,
    offers: productOffers,
    product_categories: undefined,
    product_offers: productOffers,
    product_variants: Array.isArray(product.product_variants)
      ? (product.product_variants as PublicStorefrontProductVariant[])
      : [],
    schema_markup:
      product.schema_markup && typeof product.schema_markup === 'object'
        ? (product.schema_markup as Product['schema_markup'])
        : undefined,
    specifications: Array.isArray(product.specifications)
      ? (product.specifications as Product['specifications'])
      : undefined,
    status: typeof product.status === 'string' ? product.status : undefined,
    variant_attributes:
      product.variant_attributes === null ||
      Array.isArray(product.variant_attributes) ||
      (product.variant_attributes !== null &&
        typeof product.variant_attributes === 'object')
        ? (product.variant_attributes as VariantAttributeSource)
        : undefined,
  };
}

async function getCachedStorefrontPdpCore(
  merchantId: string,
  productSlug: string
): Promise<CachedStorefrontPdpSnapshot | null> {
  'use cache';
  cacheLife('products');
  cacheTag(
    'product',
    'product-details',
    'product-lcp-hint',
    `products-${merchantId}`,
    `categories-${merchantId}`,
    getProductScopedCacheTag('product', merchantId, productSlug)
  );

  const snapshot = unwrapStorefrontReadResultForCache(
    await readStorefrontPdpCoreSnapshot(getStorefrontSnapshotSupabaseClient(), {
      merchantId,
      productSlug,
    })
  );

  if (!snapshot) return null;
  if (snapshot.kind === 'redirect') {
    return {
      kind: 'redirect',
      target: snapshot.target as unknown as CachedLegacyProductRedirectTarget,
    };
  }
  const product = normalizeCachedStorefrontPdpCore(
    snapshot.product as Record<string, unknown>
  );
  if (!product) {
    throw new StorefrontReadUnavailableError({
      kind: 'integrity',
      operation: 'pdp_core_snapshot',
      retryable: false,
    });
  }
  return {
    kind: 'product',
    product: sanitizePublicProduct(product),
  };
}

/**
 * Cached product route and image hint by slug. The shared bounded PDP snapshot
 * keeps metadata, LCP, and full product rendering on one database result;
 * image-only callers omit variants from their returned projection.
 */
export async function getCachedProductLcpHint(
  merchantId: string,
  productSlug: string,
  options: CachedProductLcpHintOptions = {}
): Promise<CachedProductLcpHint | null> {
  'use cache';
  cacheLife('products');
  cacheTag(
    'product',
    'product-lcp-hint',
    `products-${merchantId}`,
    getProductScopedCacheTag('product', merchantId, productSlug)
  );

  const snapshot = await getCachedStorefrontPdpCore(merchantId, productSlug);
  if (snapshot?.kind !== 'product') return null;

  const product = withLegacyPriceFields(snapshot.product);
  if (options.includeVariants === false) {
    const { product_variants: _variants, ...withoutVariants } = product;
    return withoutVariants;
  }

  return product;
}

/**
 * Comprehensive cached product data with all relations for product pages.
 * The bounded core snapshot returns product, category, key specs, offers,
 * variants, and serialized availability in one database round trip.
 * Uses 'products' cacheLife profile (stale 5min, revalidate 5min, expire 24hr)
 */
export async function getCachedProductWithDetails(
  merchantId: string,
  productSlug: string
) {
  'use cache';
  cacheLife('products');
  cacheTag(
    'product',
    'product-details',
    getProductScopedCacheTag('product', merchantId, productSlug)
  );

  const snapshot = await getCachedStorefrontPdpCore(merchantId, productSlug);
  return snapshot?.kind === 'product' ? snapshot.product : null;
}

interface CachedProductCanonicalCategory {
  id: string;
  name: string;
  slug: string;
  parent_id?: string | null;
}

export interface CachedProductCanonicalRedirectTarget {
  canonical_url?: string | null;
  category?: string | null;
  categories?:
    | CachedProductCanonicalCategory
    | CachedProductCanonicalCategory[]
    | null;
  id: string;
  name: string;
  slug: string;
  status?: string | null;
}

export interface CachedLegacyProductRedirectTarget {
  id: string;
  name: string;
  slug: string;
  category?: string | null;
  categories?: CachedProductCanonicalCategory | null;
}

/**
 * Narrow active-product lookup for the proxy canonical redirect preflight.
 * Keep this projection smaller than `getCachedProductWithDetails()` so normal
 * PDP requests do not hydrate variants/specs before the App Router render.
 */
export async function getCachedProductCanonicalRedirectTarget(
  merchantId: string,
  productSlug: string
): Promise<CachedProductCanonicalRedirectTarget | null> {
  // PR4a: local `'use cache'`, not the framework remote handler. The proxy
  // canonical-redirect preflight is keyed on arbitrary crawler product slugs
  // (unbounded remote keys); the origin is an indexed slug/id .maybeSingle()
  // (<15ms) and the read already fails loud, so the shared remote SET only adds
  // the exit-128 write hazard. The 308-vs-render answer is deterministic per
  // slug, so a per-instance local cache is behaviourally identical.
  'use cache';
  cacheLife('products');
  cacheTag(
    'product',
    'product-canonical-redirect',
    getProductScopedCacheTag('product', merchantId, productSlug),
    getProductScopedCacheTag(
      'product-canonical-redirect',
      merchantId,
      productSlug
    )
  );

  const supabase = getPublicSupabaseClient();
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      productSlug
    );

  let query = supabase
    .from('products')
    .select(`
        id,
        name,
        slug,
        status,
        category,
        canonical_url,
        categories:category_id(id, name, slug, parent_id)
      `)
    .eq('merchant_id', merchantId);

  if (isUuid) {
    query = query.or(
      `slug.eq.${productSlug.toLowerCase()},id.eq.${productSlug}`
    );
  } else {
    query = query.eq('slug', productSlug.toLowerCase());
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return (data as CachedProductCanonicalRedirectTarget | null) || null;
}

/**
 * Resolves archived product slugs that were consolidated into an active parent
 * product, so old variant URLs can permanently redirect to the canonical page.
 */
export async function getCachedLegacyProductRedirectTarget(
  merchantId: string,
  productSlug: string
): Promise<CachedLegacyProductRedirectTarget | null> {
  'use cache';
  cacheLife('products');
  cacheTag(
    'product',
    'product-legacy-redirect',
    getProductScopedCacheTag('product-legacy-redirect', merchantId, productSlug)
  );

  const snapshot = await getCachedStorefrontPdpCore(merchantId, productSlug);
  return snapshot?.kind === 'redirect' ? snapshot.target : null;
}

/**
 * Cached categories for a merchant.
 * Uses 'categories' cacheLife profile (stale 5min, revalidate 1hr, expire 24hr)
 */
export async function getCachedCategories(merchantId: string) {
  // PR4b review round 4: stays `'use cache: remote'` (demotion REVERTED).
  // `revalidateCategories()` busts `categories-${merchantId}` on category
  // create/update/delete, so storefront navigation freshness depends on that
  // tag reaching EVERY instance — a local entry elsewhere would keep serving
  // the retired category nav until `cacheLife` expiry. Still fail-loud (throws
  // below) with a request-local fail-open boundary (getStorefrontCategories),
  // so a transient error is never cached as empty.
  'use cache: remote';
  cacheLife('categories');
  cacheTag('categories', `categories-${merchantId}`);

  const supabase = getPublicSupabaseClient();

  const { data, error } = await supabase
    .from('categories')
    .select(`
        id,
        name,
        slug,
        description,
        image_url,
        is_active,
        parent_id
      `)
    .eq('merchant_id', merchantId)
    .order('name', { ascending: true });

  if (error) {
    console.error('Error fetching categories:', error);
    throw error;
  }

  return data || [];
}

export interface StorefrontCategoriesResult {
  categories: Awaited<ReturnType<typeof getCachedCategories>>;
  queryFailed: boolean;
}

/**
 * Request-local fallback for category lists that only enrich an otherwise
 * renderable page. The remote cached fill stays fail-loud so a transient
 * database error is never stored as an empty category list; this uncached
 * boundary records the degraded state and lets callers omit optional links.
 */
export const getStorefrontCategories = cache(
  async (merchantId: string): Promise<StorefrontCategoriesResult> => {
    try {
      return {
        categories: await getCachedCategories(merchantId),
        queryFailed: false,
      };
    } catch (error) {
      console.error('Category navigation query failed outside cache:', {
        merchantId,
        error,
      });
      return { categories: [], queryFailed: true };
    }
  }
);

const CATEGORY_PAGE_PRODUCT_DETAIL_CHUNK_SIZE = 48;
const CATEGORY_PAGE_PRODUCT_DETAIL_CONCURRENCY = 3;

interface CachedCategoryPageProductsResult {
  productIdsQueryFailed: boolean;
  productCount: number;
  productsArePrePaginated: boolean;
  products: unknown[];
  productSlots: unknown[];
  productsQueryFailed: boolean;
}

interface CachedCategoryPageProductIdsResult {
  productIds: string[];
  productsQueryFailed: boolean;
  /**
   * Exact number of products in scope. Equals productIds.length until the
   * cached ID list hits CATEGORY_PAGE_PRODUCT_ID_CAP, after which it comes
   * from a head-count query so pagination totals stay truthful (PR4b review).
   */
  totalProductCount: number;
  /**
   * False when the SUPPLEMENTARY exact-count query failed and totalProductCount
   * fell back to the length of the successfully-fetched ID list.
   *
   * The count is supplementary; the ID list is CORE. A failed count must
   * degrade the TOTALS only — it must never discard a catalog that fetched
   * fine, which would render an empty category page off an auxiliary failure
   * (PR4b review round 4). Callers must not page past the cached list on an
   * inexact count: there is no trustworthy total to page toward.
   */
  totalProductCountExact: boolean;
}

interface CategoryPageProductDetailsResult {
  missingProductCount: number;
  productSlots: Array<unknown | null>;
  productsQueryFailed: boolean;
}

const CATEGORY_PAGE_PRODUCT_BASE_SELECT = `
          id,
          name,
          slug,
          description,
          price,
          compare_at_price,
          images,
          category,
          brand,
          condition,
          stock,
          stock_quantity,
          manage_stock,
          ${PRODUCT_KEY_SPECS_RELATION_SELECT}
        `;

function getCategoryPageProductSelect(isCategoryScoped: boolean) {
  const productCategoriesSelect = isCategoryScoped
    ? 'product_categories!inner(categories(name, slug))'
    : 'product_categories(categories(name, slug))';

  return `${CATEGORY_PAGE_PRODUCT_BASE_SELECT}, ${productCategoriesSelect}`;
}

/**
 * Ranged-page size for assembling the full ID list past the cached window.
 * Matches the PostgREST max-rows clamp (Supabase managed default 1,000) so
 * each iteration fetches the largest window the server will return.
 */
const CATEGORY_PAGE_PRODUCT_ID_ASSEMBLY_PAGE_SIZE = 1000;

/**
 * Hard bound on assembly windows. At the 1,000-row page size this covers 64k
 * products — far above any real catalogue (ogabassey is ~1,333). If we somehow
 * exceed it we CANNOT prove the list is complete, so assembly throws rather
 * than hand an unbounded consumer a partial catalogue.
 */
const CATEGORY_PAGE_PRODUCT_ID_ASSEMBLY_MAX_WINDOWS = 64;

/**
 * Assembles the COMPLETE ordered product-ID list for unbounded (no-limit)
 * consumers — price-band pages and LLM category markdown publish the payload as
 * the whole catalogue, so a truncated prefix is a LIE to crawlers and caches.
 * This function therefore returns the complete list or THROWS; it never returns
 * a partial one (PR4b review round 5).
 *
 * `totalProductCount` is null when the supplementary count query failed. With a
 * known total we page until we reach it; with an unknown total we page until
 * the list is EXHAUSTED (an empty or short window), which proves completeness
 * without needing a count at all. Either way `from` strictly advances, so the
 * loop terminates.
 */
async function fetchAllCategoryPageProductIds({
  merchantId,
  scope,
  seedIds,
  totalProductCount,
}: {
  merchantId: string;
  scope: CachedCategoryPageProductScope;
  seedIds: string[];
  /** null when the exact count is unavailable — page to exhaustion instead. */
  totalProductCount: number | null;
}): Promise<string[]> {
  const ids = [...seedIds];
  const seen = new Set(ids);
  let from = ids.length;

  for (
    let windowIndex = 0;
    windowIndex < CATEGORY_PAGE_PRODUCT_ID_ASSEMBLY_MAX_WINDOWS;
    windowIndex += 1
  ) {
    if (totalProductCount !== null && ids.length >= totalProductCount) {
      // Known total reached — the list is complete.
      return ids;
    }

    const window = await categoryPageProductIdCache.fetchProductIdWindow({
      merchantId,
      scope,
      from,
      to: from + CATEGORY_PAGE_PRODUCT_ID_ASSEMBLY_PAGE_SIZE - 1,
    });

    if (window.length === 0) {
      // Exhausted. With a known total this is count drift (the cached count
      // over-reported the live rows); with an unknown total it PROVES the list
      // we already hold is the complete catalogue.
      return ids;
    }

    from += window.length;
    for (const id of window) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }

    if (window.length < CATEGORY_PAGE_PRODUCT_ID_ASSEMBLY_PAGE_SIZE) {
      // A short window is the end of the list — complete.
      return ids;
    }
  }

  throw new Error(
    `Category product ID assembly exceeded ${CATEGORY_PAGE_PRODUCT_ID_ASSEMBLY_MAX_WINDOWS} windows`
  );
}

/**
 * Request-local boundary over the two cached category reads.
 *
 * CORE (ID list) and SUPPLEMENTARY (exact count) fail INDEPENDENTLY:
 *   - ID query fails      → genuine catalog failure; flag it so consumers fail
 *                           open (never a "real" empty category).
 *   - count query fails   → the catalog is INTACT. Keep the fetched IDs and
 *                           degrade the TOTALS only, falling back to the ID-list
 *                           length so totalPages stays derivable. Emptying the
 *                           page because an auxiliary COUNT failed would render
 *                           an empty catalog / 404 a live category — core data
 *                           must never be discarded for an auxiliary failure
 *                           (PR4b review round 4).
 */
async function getCategoryPageProductIds({
  merchantId,
  scope,
}: {
  merchantId: string;
  scope: CachedCategoryPageProductScope;
}): Promise<CachedCategoryPageProductIdsResult> {
  let productIds: string[];

  try {
    productIds =
      scope.kind === 'legacy'
        ? await categoryPageProductIdCache.getLegacyProductIds({
            merchantId,
            scope,
          })
        : await categoryPageProductIdCache.getProductIds({ merchantId, scope });
  } catch (error) {
    console.error('Product ID query failed outside cache:', error);
    return {
      productIds: [],
      productsQueryFailed: true,
      totalProductCount: 0,
      totalProductCountExact: false,
    };
  }

  try {
    const exactCount =
      scope.kind === 'legacy'
        ? await categoryPageProductIdCache.getLegacyProductTotalCount({
            merchantId,
            scope,
          })
        : await categoryPageProductIdCache.getProductTotalCount({
            merchantId,
            scope,
          });

    return {
      productIds,
      productsQueryFailed: false,
      totalProductCount: Math.max(exactCount, productIds.length),
      totalProductCountExact: true,
    };
  } catch (error) {
    console.error('Product count query failed outside cache:', error);

    return {
      productIds,
      productsQueryFailed: false,
      totalProductCount: productIds.length,
      totalProductCountExact: false,
    };
  }
}

/**
 * Direct product detail fetch for an ordered ID slice.
 *
 * This is deliberately local-cached, not remote-cached. Rich category-card
 * payloads include descriptions, images, and key specs, so writing them to
 * Vercel's remote cache can still trip per-item byte limits. The shared remote
 * ID list carries membership/order; detail rows are bounded by stable ID slices.
 */
async function getCachedCategoryPageProductDetailsChunk({
  categoryIds,
  merchantId,
  productIds,
}: {
  categoryIds?: string[];
  merchantId: string;
  productIds: string[];
}): Promise<CategoryPageProductDetailsResult> {
  'use cache';
  cacheLife('products');
  cacheTag(
    'category-page-data',
    'products',
    'categories',
    `products-${merchantId}`,
    `categories-${merchantId}`
  );

  if (productIds.length === 0) {
    return {
      missingProductCount: 0,
      productSlots: [],
      productsQueryFailed: false,
    };
  }

  const supabase = getPublicSupabaseClient();
  const isCategoryScoped = Boolean(categoryIds?.length);
  let query = supabase
    .from('products')
    .select(getCategoryPageProductSelect(isCategoryScoped))
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .in('id', productIds);

  if (isCategoryScoped && categoryIds) {
    query = query.in('product_categories.category_id', categoryIds);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const productsById = new Map(
    ((data || []) as Array<{ id?: string | null }>).map((product) => [
      product.id,
      product,
    ])
  );

  const productSlots = productIds.map(
    (productId) => productsById.get(productId) ?? null
  );

  return {
    missingProductCount: productSlots.filter((product) => product === null)
      .length,
    productSlots: productSlots.filter(
      (product): product is { id?: string | null } => product !== null
    ),
    productsQueryFailed: false,
  };
}

async function getCategoryPageProductDetailsChunk({
  categoryIds,
  merchantId,
  productIds,
}: {
  categoryIds?: string[];
  merchantId: string;
  productIds: string[];
}): Promise<CategoryPageProductDetailsResult> {
  try {
    return await getCachedCategoryPageProductDetailsChunk({
      categoryIds,
      merchantId,
      productIds,
    });
  } catch (error) {
    console.error('Product detail query error:', error);
    return {
      missingProductCount: 0,
      productSlots: productIds.map(() => null),
      productsQueryFailed: true,
    };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );

  return results;
}

/**
 * Every way a category product read can come back incomplete.
 *
 * This record is the contract's single source of truth: the unbounded guard
 * below is EXHAUSTIVE over its keys, so adding a new failure leg means adding a
 * field here — and the guard covers it automatically. That is what stops the
 * r5 mistake from recurring, where the all-or-nothing rule was wired to only
 * ONE leg (tail assembly) and the ID-list and detail-chunk legs quietly leaked
 * truncated catalogues to the unbounded consumers (PR4b review r6).
 */
interface CategoryPageProductFailureSignals {
  /** The core ordered-ID read failed (an outage, NOT an empty category). */
  productIdsQueryFailed: boolean;
  /** The requested window failed, or could not be verified as in-range. */
  productWindowUnusable: boolean;
  /** Full-catalogue tail assembly failed (unbounded reads only). */
  catalogueAssemblyFailed: boolean;
  /** One or more product-detail chunks failed. */
  productDetailsQueryFailed: boolean;
}

/**
 * THE all-or-nothing guard for unbounded category reads.
 *
 * Unbounded consumers (price-band page, LLM category markdown) publish the
 * payload as the COMPLETE catalogue and never inspect the fail-open flags, so
 * ANY incomplete read must reach them as an explicit, retryable failure rather
 * than a quietly truncated list. Bounded (paginated) consumers keep the
 * fail-open flags: a storefront page may degrade gracefully; a feed claiming to
 * be the whole catalogue may not.
 *
 * Iterating the record (rather than testing named fields) is deliberate — a new
 * leg cannot forget to opt in.
 */
function assertUnboundedCatalogueIsComplete(
  signals: CategoryPageProductFailureSignals,
  hasBoundedWindow: boolean
): void {
  if (hasBoundedWindow) {
    return;
  }

  const failedLegs = (
    Object.keys(signals) as Array<keyof CategoryPageProductFailureSignals>
  ).filter((leg) => signals[leg]);

  if (failedLegs.length === 0) {
    return;
  }

  throw new StorefrontReadUnavailableError({
    kind: 'database',
    operation: `category_page_complete_catalogue (${failedLegs.join(', ')})`,
    retryable: true,
  });
}

async function getCachedCategoryPageProductsUncached({
  merchantId,
  productLimit,
  productOffset,
  scope,
}: {
  merchantId: string;
  productLimit?: number;
  productOffset?: number;
  scope: CachedCategoryPageProductScope;
}): Promise<CachedCategoryPageProductsResult> {
  const windowStart = productOffset ?? 0;
  const hasBoundedWindow = typeof productLimit === 'number' && productLimit > 0;

  // Every failure leg records here. The unbounded all-or-nothing guard below is
  // EXHAUSTIVE over this record, so a new leg is covered the moment it adds a
  // field — it cannot silently skip the contract (PR4b review r6).
  const failureSignals: CategoryPageProductFailureSignals = {
    productIdsQueryFailed: false,
    productWindowUnusable: false,
    catalogueAssemblyFailed: false,
    productDetailsQueryFailed: false,
  };

  const idResult = await getCategoryPageProductIds({
    merchantId,
    scope,
  });
  failureSignals.productIdsQueryFailed = idResult.productsQueryFailed;

  if (idResult.productIds.length === 0) {
    // A genuinely empty category returns an empty catalogue; a FAILED ID read
    // must not masquerade as one (an unbounded consumer would publish it as an
    // empty catalogue and 404 a valid page), so it funnels through the guard.
    assertUnboundedCatalogueIsComplete(failureSignals, hasBoundedWindow);

    return {
      productIdsQueryFailed: idResult.productsQueryFailed,
      productCount: 0,
      productsArePrePaginated: Boolean(productLimit),
      products: [],
      productSlots: [],
      productsQueryFailed: idResult.productsQueryFailed,
    };
  }

  let productWindow: string[];

  if (!hasBoundedWindow) {
    // UNBOUNDED read (price-band page, LLM category markdown). These consumers
    // publish the payload as the COMPLETE catalogue and do not check
    // productsQueryFailed, so a truncated prefix would ship an incomplete
    // inventory to crawlers and caches. This path is therefore ALL-OR-NOTHING:
    // the complete catalogue, or an explicit typed failure (PR4b review r5).
    try {
      productWindow = await fetchAllCategoryPageProductIds({
        merchantId,
        scope,
        seedIds: idResult.productIds,
        // null → no trustworthy total; assembly pages to exhaustion instead,
        // which proves completeness without a count.
        totalProductCount: idResult.totalProductCountExact
          ? idResult.totalProductCount
          : null,
      });
    } catch (error) {
      console.error('Full product ID assembly failed outside cache:', error);
      // Record the leg and let the SINGLE exit guard throw. Degrading to the
      // capped prefix here would be the "lie to crawlers" the plan forbids.
      productWindow = idResult.productIds;
      failureSignals.catalogueAssemblyFailed = true;
    }
  } else if (
    windowStart + productLimit <= idResult.productIds.length ||
    (idResult.totalProductCountExact &&
      idResult.totalProductCount <= idResult.productIds.length)
  ) {
    // Common case: the cached (possibly capped) ID list fully covers the
    // requested window, or the total is PROVEN and the list is complete — so an
    // out-of-range slice is a genuinely out-of-range page and the route may 404.
    productWindow = idResult.productIds.slice(
      windowStart,
      windowStart + productLimit
    );
  } else {
    // The window extends past the cached list and we cannot show it is out of
    // range — either more products provably exist, or the total is unverified.
    // PROBE the requested range directly. Probing regardless of count certainty
    // is what stops a transient count failure from 404ing a valid deep page
    // (PR4b review r5).
    try {
      productWindow = await categoryPageProductIdCache.fetchProductIdWindow({
        merchantId,
        scope,
        from: windowStart,
        to: windowStart + productLimit - 1,
      });

      if (productWindow.length === 0 && !idResult.totalProductCountExact) {
        // Zero rows + an UNVERIFIED total is not proof of an out-of-range page.
        // Signal uncertainty so the route fails open (200, empty, noindex)
        // instead of emitting a confident 404 on a total we never verified.
        failureSignals.productWindowUnusable = true;
      }
    } catch (error) {
      console.error('Product ID window query failed outside cache:', error);
      productWindow = [];
      failureSignals.productWindowUnusable = true;
    }
  }

  const idChunks = Array.from(
    {
      length: Math.ceil(
        productWindow.length / CATEGORY_PAGE_PRODUCT_DETAIL_CHUNK_SIZE
      ),
    },
    (_, chunkIndex) =>
      productWindow.slice(
        chunkIndex * CATEGORY_PAGE_PRODUCT_DETAIL_CHUNK_SIZE,
        (chunkIndex + 1) * CATEGORY_PAGE_PRODUCT_DETAIL_CHUNK_SIZE
      )
  );
  const detailChunks = await mapWithConcurrency(
    idChunks,
    CATEGORY_PAGE_PRODUCT_DETAIL_CONCURRENCY,
    (productIds) =>
      getCategoryPageProductDetailsChunk({
        categoryIds: scope.kind === 'category' ? scope.categoryIds : undefined,
        merchantId,
        productIds,
      })
  );
  const productSlots = detailChunks.flatMap((chunk) => chunk.productSlots);
  const missingProductCount = detailChunks.reduce(
    (count, chunk) => count + chunk.missingProductCount,
    0
  );
  failureSignals.productDetailsQueryFailed = detailChunks.some(
    (chunk) => chunk.productsQueryFailed
  );

  // Exact scope size (head-count-backed past the cap), not the truncated cached
  // list length — keeps totalPages truthful (PR4b review fix). The floor also
  // covers the window we actually served: when the count is unverified, the
  // cached list length alone would put totalPages BELOW the page we just
  // returned rows for, and the route would 404 it (PR4b review r5).
  // The floor only covers rows we ACTUALLY served: an empty window must not
  // inflate the total (that would invent pages), which is why this mirrors the
  // `itemCount > 0` guard in getEstimatedPaginationCountFloor.
  const paginationCountFloor =
    productWindow.length > 0
      ? Math.max(idResult.totalProductCount, windowStart + productWindow.length)
      : idResult.totalProductCount;

  // SINGLE EXIT GUARD for the all-or-nothing contract. Every failure leg above
  // records into `failureSignals` instead of throwing at its own site, so the
  // rule lives in exactly ONE place (PR4b review r6).
  assertUnboundedCatalogueIsComplete(failureSignals, hasBoundedWindow);

  return {
    productIdsQueryFailed:
      failureSignals.productIdsQueryFailed ||
      failureSignals.productWindowUnusable,
    productCount: Math.max(0, paginationCountFloor - missingProductCount),
    productsArePrePaginated: Boolean(productLimit),
    products: productSlots.filter(
      (product): product is unknown => product !== null
    ),
    productSlots,
    productsQueryFailed:
      failureSignals.productIdsQueryFailed ||
      failureSignals.productWindowUnusable ||
      failureSignals.productDetailsQueryFailed,
  };
}

const getCachedCategoryPageProducts = cache(
  (
    merchantId: string,
    scope: CachedCategoryPageProductScope,
    productOffset?: number,
    productLimit?: number
  ) =>
    getCachedCategoryPageProductsUncached({
      merchantId,
      productLimit,
      productOffset,
      scope,
    })
);

/**
 * Cache-friendly data fetcher for Category/Collection pages.
 * The unbounded aggregate wrapper itself is intentionally not remote-cached.
 * Instead, its shell and product chunks are cached remotely as bounded records
 * so category/product revalidation stays shared across Vercel instances without
 * putting the entire product array into one 2 MB-limited cache item.
 */
export async function getCachedCategoryPageData(
  merchantId: string,
  categorySlug: string,
  _storeSlug: string,
  productOffset?: number,
  productLimit?: number
): Promise<CachedCategoryPageData> {
  const shell = await getCategoryPageShellData(merchantId, categorySlug);
  const productResult = await getCachedCategoryPageProducts(
    merchantId,
    shell.productScope,
    productOffset,
    productLimit
  );

  if (shell.isCollection) {
    return {
      isCollection: true,
      name: shell.name,
      description: shell.description,
      fallbackName: shell.fallbackName,
      fallbackDescription: shell.fallbackDescription,
      seo: shell.seo,
      ...(productResult.productIdsQueryFailed
        ? { productIdsQueryFailed: true }
        : {}),
      productCount: productResult.productCount,
      ...(productResult.productsArePrePaginated
        ? { productsArePrePaginated: true }
        : {}),
      products: productResult.products,
      ...(productResult.productSlots.length !== productResult.products.length
        ? { productSlots: productResult.productSlots }
        : {}),
      productsQueryFailed: productResult.productsQueryFailed,
    };
  }

  return {
    isCollection: false,
    category: shell.category,
    fallbackName: shell.fallbackName,
    fallbackDescription: shell.fallbackDescription,
    isInactiveCategory: shell.isInactiveCategory,
    categoryQueryFailed: shell.categoryQueryFailed,
    ...(shell.categoryQueryFailed || productResult.productIdsQueryFailed
      ? { productIdsQueryFailed: true }
      : {}),
    productCount: productResult.productCount,
    ...(productResult.productsArePrePaginated
      ? { productsArePrePaginated: true }
      : {}),
    products: productResult.products,
    ...(productResult.productSlots.length !== productResult.products.length
      ? { productSlots: productResult.productSlots }
      : {}),
    productsQueryFailed:
      Boolean(shell.categoryQueryFailed) || productResult.productsQueryFailed,
  };
}

/**
 * Cached product reviews.
 * Uses 'products' cacheLife profile (stale 5min, revalidate 5min, expire 24hr)
 */
async function getCachedProductReviewsRead(
  productId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
) {
  'use cache';
  cacheLife('products');
  cacheTag('reviews', `reviews-${productId}`);

  const supabase = getPublicSupabaseClient();

  let query = supabase
    .from('product_reviews')
    .select(`
        id,
        rating,
        review_title:title,
        review_text:body,
        reviewer_name:customer_name,
        is_verified_purchase:verified_purchase,
        helpful_count,
        created_at,
        merchant_response,
        response_at:merchant_response_at
      `)
    .eq('product_id', productId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false });

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.offset) {
    query = query.range(
      options.offset,
      options.offset + (options.limit || 10) - 1
    );
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

export async function getCachedProductReviews(
  productId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
) {
  try {
    return await getCachedProductReviewsRead(productId, options);
  } catch (error) {
    console.warn('Optional PDP reviews unavailable', { productId, error });
    return [];
  }
}

/**
 * Cached product rating stats.
 * Uses 'products' cacheLife profile (stale 5min, revalidate 5min, expire 24hr)
 */
async function getCachedProductRatingStatsRead(productId: string) {
  'use cache';
  cacheLife('products');
  cacheTag('reviews', `rating-stats-${productId}`);

  const supabase = getPublicSupabaseClient();

  const { data, error } = await supabase
    .from('product_reviews')
    .select('rating')
    .eq('product_id', productId)
    .eq('status', 'approved');

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    return {
      averageRating: 0,
      totalReviews: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };
  }

  const totalReviews = data.length;
  const sumRatings = data.reduce((sum, r) => sum + r.rating, 0);
  const averageRating = sumRatings / totalReviews;

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  data.forEach((r) => {
    const rating = r.rating as 1 | 2 | 3 | 4 | 5;
    if (rating >= 1 && rating <= 5) {
      distribution[rating]++;
    }
  });

  return {
    averageRating: Math.round(averageRating * 10) / 10,
    totalReviews,
    distribution,
  };
}

function getEmptyProductRatingStats() {
  return {
    averageRating: 0,
    totalReviews: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };
}

export async function getCachedProductRatingStats(productId: string) {
  try {
    return await getCachedProductRatingStatsRead(productId);
  } catch (error) {
    console.warn('Optional PDP rating stats unavailable', { productId, error });
    return getEmptyProductRatingStats();
  }
}

/**
 * Create a Supabase client with Service Role key for secure operations.
 * SERVER-SIDE ONLY. Never use on client.
 */
function getServiceSupabaseClient() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey(); // Throws if on client or missing

  return createSupabaseClient(url, key, {
    global: {
      // This client previously had NO transport bound at all — and it sits
      // inside the hot merchant shell path via getCachedFeatureSettings.
      fetch: createTimeoutComposedFetch(CACHED_CLIENT_DEFAULT_TIMEOUT_MS),
    },
  });
}

/**
 * Cached dashboard stats (Revenue, Orders, etc.)
 * Uses 'merchant' cacheLife profile (revalidate 60s)
 */
export async function getCachedDashboardStats(merchantId: string) {
  // PR4b review round 4: stays `'use cache: remote'` (demotion REVERTED).
  // `dashboard-${merchantId}` is busted by revalidateProducts(),
  // revalidateMerchant() AND revalidateMerchantPublication() — a merchant who
  // adds a product expects the dashboard to reflect it, and a local entry on
  // another instance would keep serving pre-mutation metrics until `cacheLife`
  // expiry. Still fail-loud so a transient RPC error is never persisted as
  // null; the dashboard action's own try/catch degrades to zero metrics
  // outside the cache scope. A genuine null summary (no error) still returns
  // null.
  'use cache: remote';
  cacheLife('merchant');
  cacheTag('dashboard', `dashboard-${merchantId}`);

  const supabase = getServiceSupabaseClient();

  const { data: stats, error } = await supabase.rpc(
    'get_sales_dashboard_stats',
    { p_merchant_id: merchantId }
  );

  if (error) {
    console.error('Error fetching cached dashboard stats:', error);
    throw error;
  }

  return stats;
}

/**
 * Cached platform analytics (Admin).
 * Uses 'products' cacheLife profile (revalidate 5min)
 */
export async function getCachedPlatformAnalytics(
  startDate: string,
  endDate: string
) {
  // PR4b review round 4: stays `'use cache: remote'` (demotion REVERTED).
  // The admin "refresh analytics views" route calls revalidateAnalytics(),
  // which busts the `analytics` tag — an EXPLICIT, user-triggered invalidation
  // contract. Demoting it to local would leave the refresh button silently
  // broken for any request served by another instance. Still fail-loud so a
  // transient aggregate error is never cached as null; the admin route's
  // enclosing try/catch returns 500 outside the cache scope.
  'use cache: remote';
  cacheLife('products');
  cacheTag('analytics');

  const supabase = getServiceSupabaseClient();

  const { data: summaryData, error: summaryError } = await supabase.rpc(
    'get_platform_analytics_summary',
    {
      p_start_date: startDate,
      p_end_date: endDate,
    }
  );

  if (summaryError) {
    console.error('Error fetching cached platform analytics:', summaryError);
    throw summaryError;
  }

  return summaryData;
}

function isMissingRepairsCatalogEnabledColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as {
    code?: unknown;
    details?: unknown;
    hint?: unknown;
    message?: unknown;
  };
  const combined = [maybeError.message, maybeError.details, maybeError.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  return (
    maybeError.code === '42703' && combined.includes('repairs_catalog_enabled')
  );
}

async function queryMerchantFeatureSettings(
  supabase: SupabaseClient,
  merchantId: string,
  selectColumns = MERCHANT_PUBLIC_FEATURE_SETTINGS_SELECT
) {
  return await supabase
    .from('merchant_feature_settings')
    .select(selectColumns)
    .eq('merchant_id', merchantId)
    .maybeSingle();
}

function normalizeMerchantFeatureSettings(
  merchantId: string,
  data: unknown
): MerchantFeatureSettings {
  if (!data) {
    return merchantFeatureSettingsDefaults.buildPublicDefault(
      merchantId
    ) as MerchantFeatureSettings;
  }

  return {
    repairs_catalog_enabled: false,
    ...(data as Record<string, unknown>),
  } as MerchantFeatureSettings;
}

async function getPublicFeatureSettingsWithMigrationFallback(
  supabase: SupabaseClient,
  merchantId: string
): Promise<MerchantFeatureSettings> {
  const { data, error } = await queryMerchantFeatureSettings(
    supabase,
    merchantId
  );

  if (!error) {
    return normalizeMerchantFeatureSettings(merchantId, data);
  }

  if (!isMissingRepairsCatalogEnabledColumn(error)) {
    throw error;
  }

  console.warn(
    'merchant_feature_settings.repairs_catalog_enabled is unavailable; using legacy public feature settings projection'
  );
  const { data: legacyData, error: legacyError } =
    await queryMerchantFeatureSettings(
      supabase,
      merchantId,
      MERCHANT_PUBLIC_FEATURE_SETTINGS_LEGACY_SELECT
    );

  if (legacyError) {
    throw legacyError;
  }

  return normalizeMerchantFeatureSettings(merchantId, legacyData);
}

/**
 * Cached merchant feature settings.
 * Uses a server-only service-role query with an explicit public-safe column allowlist because
 * this table also stores private integration credentials.
 * Uses local Cache Components caching to avoid Vercel RemoteCacheHandler failures
 * on the hot storefront merchant shell path.
 */
export async function getCachedFeatureSettings(
  merchantId: string
): Promise<MerchantFeatureSettings | null> {
  'use cache';
  cacheLife('products');
  cacheTag(`features-${merchantId}`);

  try {
    const supabase = getServiceSupabaseClient();
    return await getPublicFeatureSettingsWithMigrationFallback(
      supabase,
      merchantId
    );
  } catch (error) {
    console.error('Error fetching feature settings:', error);
    // Rethrow so Cache Components skips caching this failure.
    throw error;
  }
}

/**
 * Whether a merchant has a Paystack subaccount configured, derived server-side
 * via the bounded, published-scoped `storefront_merchant_has_paystack_subaccount`
 * SECURITY DEFINER RPC — never exposing the raw `paystack_subaccount_code`.
 * Cached per merchant on the same `features-<id>` tag as the feature settings so
 * it invalidates together and stays off the hot public path's request timeline.
 */
export async function getCachedMerchantPaystackSubaccountConfigured(
  merchantId: string
): Promise<boolean> {
  'use cache';
  cacheLife('products');
  cacheTag(`features-${merchantId}`);

  const supabase = getPublicSupabaseClient();
  const { data, error } = await supabase.rpc(
    'storefront_merchant_has_paystack_subaccount',
    { p_merchant_id: merchantId }
  );
  if (error) {
    console.error('Error checking paystack subaccount presence:', error);
    // Rethrow so Cache Components skip caching this failure.
    throw error;
  }
  return Boolean(data);
}

/**
 * Cache only the route-critical blog post read. Transient failures throw so a
 * cache entry can never turn a temporarily unavailable post into a 404.
 */
async function getCachedBlogPostCore(
  identifier: string,
  postSlug: string,
  includeDrafts: boolean = false
) {
  'use cache';
  cacheLife('blog');
  cacheTag('blog-posts', getBlogCacheTag(identifier, postSlug));

  const lookupKey = identifier.toLowerCase();
  const merchant = await getMerchantStrict(lookupKey);

  if (!merchant) return null;

  if (!merchant.feature_settings?.blog_enabled) return null;

  const supabase = getPublicSupabaseClient();

  // Fetch Post
  let query = supabase
    .from('blog_posts')
    .select(STOREFRONT_BLOG_POST_SELECT)
    .eq('merchant_id', merchant.id)
    .eq('slug', postSlug.toLowerCase());

  if (!includeDrafts) {
    query = query.eq('status', 'published').not('published_at', 'is', null);
  }

  const { data: post, error: postError } = await query.single();

  if (postError) {
    if (postError.code === 'PGRST116') return null;
    console.error('Error fetching blog post:', postError);
    throw postError;
  }
  if (!post) return null;
  if (!includeDrafts && !isPublicBlogPost(post)) {
    return null;
  }

  return {
    merchant: {
      id: merchant.id,
      business_name: merchant.business_name,
      slug: merchant.slug,
      logo_url: merchant.logo_url,
      custom_domain: merchant.custom_domain,
      country: merchant.country,
      social_media: merchant.social_media,
    },
    post,
  };
}

type CachedBlogPostCore = NonNullable<
  Awaited<ReturnType<typeof getCachedBlogPostCore>>
>;

/**
 * Cache successful optional enrichment independently from the core post.
 * Every query error escapes this cache scope; the public wrapper applies a
 * request-local empty fallback so a transient failure is never persisted.
 */
async function getCachedBlogPostEnrichment(core: CachedBlogPostCore) {
  'use cache';
  cacheLife('blog');
  cacheTag('blog-posts', 'products', `products-${core.merchant.id}`);

  const { merchant, post } = core;
  const supabase = getPublicSupabaseClient();

  // Fetch Related Posts. Over-fetch bounded public candidate sets and rank
  // server-side by semantic overlap instead of category-only filtering.
  const buildRelatedPostsQuery = () => {
    let relatedQuery = supabase
      .from('blog_posts')
      .select(RELATED_BLOG_POST_SELECT)
      .eq('merchant_id', merchant.id)
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .not('title', 'is', null)
      .not('slug', 'is', null)
      .neq('title', '')
      .neq('slug', '')
      .neq('id', post.id)
      .order('published_at', { ascending: false });

    relatedQuery = applyPublicBlogSqlFilters(relatedQuery);

    return relatedQuery;
  };

  const recentRelatedPostsPromise = buildRelatedPostsQuery().limit(
    RELATED_BLOG_POSTS_FETCH_LIMIT
  );
  const sourceBlogCategory =
    typeof post.category === 'string' ? post.category.trim() : '';
  const categoryRelatedPostsPromise = sourceBlogCategory
    ? buildRelatedPostsQuery()
        .eq('category', sourceBlogCategory)
        .limit(RELATED_BLOG_CATEGORY_FETCH_LIMIT)
    : Promise.resolve({ data: null, error: null });

  const [
    { data: recentRelatedPosts, error: relatedPostsError },
    { data: categoryRelatedPosts, error: categoryRelatedPostsError },
    { data: linkedProducts, error: linkedProductsError },
  ] = await Promise.all([
    recentRelatedPostsPromise,
    categoryRelatedPostsPromise,
    getOrderedBlogPostProductLinks(supabase, merchant.id, post.id),
  ]);

  if (relatedPostsError) {
    throw relatedPostsError;
  }

  if (categoryRelatedPostsError) {
    throw categoryRelatedPostsError;
  }

  const relatedPostCandidates = combineUniqueRelatedBlogPosts(
    recentRelatedPosts,
    categoryRelatedPosts
  );

  if (linkedProductsError) {
    throw linkedProductsError;
  }

  let normalizedRelatedProducts = normalizeRelatedBlogProductLinks(
    linkedProducts
  ).slice(0, 8);

  const normalizedCategorySlug = normalizeStorefrontCategoryValue(
    post.category
  );

  if (normalizedRelatedProducts.length === 0 && normalizedCategorySlug) {
    const { data: relatedProducts, error: relatedProductsError } =
      await supabase
        .from('products')
        .select(RELATED_BLOG_PRODUCTS_SELECT)
        .eq('merchant_id', merchant.id)
        .eq('status', 'active')
        .eq('categories.slug', normalizedCategorySlug)
        .order('updated_at', { ascending: false })
        .limit(6);

    if (relatedProductsError) {
      throw relatedProductsError;
    }

    normalizedRelatedProducts = normalizeRelatedBlogProducts(relatedProducts);
  }

  return {
    relatedPosts: selectSemanticRelatedBlogPosts(
      post,
      filterPublicBlogPosts(relatedPostCandidates),
      RELATED_BLOG_POSTS_LIMIT
    ),
    relatedProducts: normalizedRelatedProducts,
  };
}

/**
 * Public blog post contract. Core content and route identity are cached
 * independently from optional links. Optional failures degrade only the
 * current request and remain retryable on the next request.
 */
export async function getCachedBlogPost(
  identifier: string,
  postSlug: string,
  includeDrafts: boolean = false
) {
  const core = await getCachedBlogPostCore(identifier, postSlug, includeDrafts);

  if (!core) return null;

  try {
    const enrichment = await getCachedBlogPostEnrichment(core);
    return { ...core, ...enrichment };
  } catch (error) {
    console.warn('Optional blog post enrichment unavailable', {
      merchantId: core.merchant.id,
      postId: core.post.id,
      error,
    });
    return { ...core, relatedPosts: [], relatedProducts: [] };
  }
}

/** Cache the route-critical paginated post list, but not optional categories. */
async function getCachedBlogListingCore(
  identifier: string,
  category: string | undefined,
  page: number,
  searchQuery: string | undefined
) {
  'use cache';
  // A `'use cache'` function takes a single static cache profile, so the
  // listing stays on the short `merchant` profile: it takes user-supplied
  // search/category args, and keeping it short avoids retaining unbounded
  // one-off filter permutations. The high-cost blog POST renders are what move
  // to the long-lived `blog` profile (see getCachedBlogPost).
  cacheLife('merchant');
  cacheTag(
    'blog-posts',
    `blog-list-${identifier.toLowerCase()}-${category || 'all'}-${page}`
  );

  const limit = BLOG_LISTING_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const lookupKey = identifier.toLowerCase();
  const merchant = await getMerchantStrict(lookupKey);

  if (!merchant) return null;

  if (!merchant.feature_settings?.blog_enabled) return null;

  const supabase = getPublicSupabaseClient();

  let query = supabase
    .from('blog_posts')
    .select(
      'id, title, slug, excerpt, featured_image_url, featured_image_alt, featured_image_variants, category, tags, author_name, published_at, reading_time_minutes, view_count',
      PUBLIC_BLOG_COUNT_OPTIONS
    )
    .eq('merchant_id', merchant.id)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .not('title', 'is', null)
    .not('slug', 'is', null)
    .neq('title', '')
    .neq('slug', '')
    .order('published_at', { ascending: false })
    // Unique tiebreaker: scheduled/bulk-published posts share an identical
    // published_at, and without a total order the same post can appear on two
    // listing pages (or neither) when the prerender walk pages through this
    // query. `id` makes pagination deterministic (mirrors the product index).
    .order('id', { ascending: true });

  query = applyPublicBlogSqlFilters(query);

  if (category) {
    query = query.eq('category', category);
  }

  if (searchQuery) {
    const sanitizedSearch = searchQuery.trim().slice(0, 100);

    if (sanitizedSearch) {
      query = query.textSearch('search_vector', sanitizedSearch, {
        type: 'websearch',
        config: 'english',
      });
    }
  }

  query = query.range(offset, offset + limit - 1);

  const { data: posts, count, error: postsError } = await query;
  if (postsError) {
    console.error('Failed to load blog posts', {
      merchantId: merchant.id,
      error: postsError,
    });
    throw postsError;
  }

  const publicPosts = filterPublicBlogPosts(posts || []);
  const totalPosts = getEstimatedPaginationCountFloor({
    count,
    itemCount: publicPosts.length,
    limit,
    page,
  });

  return {
    merchant: {
      id: merchant.id,
      business_name: merchant.business_name,
      slug: merchant.slug,
      logo_url: merchant.logo_url,
      template_id: merchant.template_id,
      custom_domain: merchant.custom_domain,
      country: merchant.country,
      social_media: merchant.social_media,
    },
    posts: publicPosts,
    totalPosts,
    currentPage: page,
    totalPages: Math.ceil(totalPosts / limit),
    searchQuery,
  };
}

async function getCachedBlogListingCategories(merchantId: string) {
  'use cache';
  cacheLife('merchant');
  cacheTag('blog-posts', `blog-categories-${merchantId}`);

  const supabase = getPublicSupabaseClient();
  let categoriesQuery = supabase
    .from('blog_posts')
    .select('category')
    .eq('merchant_id', merchantId)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .not('title', 'is', null)
    .not('slug', 'is', null)
    .neq('title', '')
    .neq('slug', '')
    .not('category', 'is', null);

  categoriesQuery = applyPublicBlogSqlFilters(categoriesQuery, {
    includeCategoryFilters: true,
  });

  const { data: categories, error: categoriesError } = await categoriesQuery;
  if (categoriesError) {
    throw categoriesError;
  }

  const uniqueCategories = [
    ...new Set(categories?.map((entry) => entry.category).filter(Boolean)),
  ];
  return filterPublicBlogCategories(uniqueCategories);
}

/**
 * Public blog listing contract. Optional category navigation is isolated from
 * the cached post list so a failed category query cannot persist as an empty
 * navigation taxonomy.
 */
export async function getCachedBlogListing(
  identifier: string,
  options?: {
    category?: string;
    page?: number;
    searchQuery?: string;
  }
) {
  const category = options?.category;
  const page = options?.page || 1;
  const normalizedSearchQuery =
    options?.searchQuery?.trim().slice(0, 100) || undefined;
  const core = await getCachedBlogListingCore(
    identifier,
    category,
    page,
    normalizedSearchQuery
  );

  if (!core) return null;

  let categories: string[] = [];
  try {
    categories = await getCachedBlogListingCategories(core.merchant.id);
  } catch (error) {
    console.warn('Optional blog categories unavailable', {
      merchantId: core.merchant.id,
      error,
    });
  }

  return {
    ...core,
    categories,
  };
}

/**
 * Cached published posts + denormalized identity for a single blog author,
 * matched by generated author slug. Powers the `/blog/author/<slug>` pages. The
 * author's title/bio/headshot are read from the most recent post (they are
 * denormalized identically across an author's posts); `sameAs` is supplied
 * separately from the in-code author registry.
 */
export async function getCachedBlogAuthor(
  identifier: string,
  authorName: string,
  options?: { page?: number }
) {
  'use cache';
  const requestedPage = options?.page ?? 1;
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const authorSlug = generateSlug(authorName);
  if (!authorSlug) return null;
  cacheLife('merchant');
  cacheTag(
    'blog-posts',
    `blog-author-${identifier.toLowerCase()}-${authorSlug}-${page}`
  );

  const limit = BLOG_LISTING_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const merchant = await getMerchantStrict(identifier.toLowerCase());
  if (!merchant) return null;

  if (!merchant.feature_settings?.blog_enabled) return null;

  const supabase = getPublicSupabaseClient();

  let query = supabase
    .from('blog_posts')
    .select(
      'id, title, slug, excerpt, featured_image_url, featured_image_alt, category, author_name, author_title, author_bio, author_image_url, published_at, reading_time_minutes',
      PUBLIC_BLOG_COUNT_OPTIONS
    )
    .eq('merchant_id', merchant.id)
    .eq('status', 'published')
    .eq('author_name', authorName)
    .not('published_at', 'is', null)
    .not('title', 'is', null)
    .not('slug', 'is', null)
    .neq('title', '')
    .neq('slug', '')
    .order('published_at', { ascending: false });

  query = applyPublicBlogSqlFilters(query);
  query = query.range(offset, offset + limit - 1);

  const { data: posts, count, error: postsError } = await query;
  if (postsError) {
    console.error('Failed to load blog author posts', {
      merchantId: merchant.id,
      authorName,
      error: postsError,
    });
    throw postsError;
  }

  const publicPosts = filterPublicBlogPosts(posts || []);
  const totalCount = getEstimatedPaginationCountFloor({
    count,
    itemCount: publicPosts.length,
    limit,
    page,
  });
  // No public posts anywhere for this author -> genuine missing author (404).
  if (totalCount === 0) {
    return null;
  }
  // `identity` is absent only on an out-of-range page (count > 0 but this
  // ranged window is empty); the route redirects those stale paginated URLs to
  // the last valid page rather than 404ing a real author.
  const identity = publicPosts[0];

  return {
    merchant: {
      id: merchant.id,
      business_name: merchant.business_name,
      slug: merchant.slug,
      logo_url: merchant.logo_url,
      custom_domain: merchant.custom_domain,
    },
    author: {
      name: authorName,
      title: identity?.author_title ?? null,
      bio: identity?.author_bio ?? null,
      imageUrl: identity?.author_image_url ?? null,
    },
    posts: publicPosts,
    totalPosts: totalCount,
    currentPage: page,
    totalPages: Math.max(1, Math.ceil(totalCount / limit)),
  };
}

export interface StorefrontHomeProductDirectCategoryRecord {
  id?: string | null;
  name?: string | null;
  slug?: string | null;
  parent_id?: string | null;
}

interface StorefrontHomeProductCategoryJoinRecord {
  categories?:
    | StorefrontHomeProductDirectCategoryRecord
    | StorefrontHomeProductDirectCategoryRecord[]
    | null;
}

export interface StorefrontHomeProduct {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  price?: number | string | null;
  compare_at_price?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  images?: unknown[] | null;
  category?: string | null;
  brand?: string | null;
  condition?: string | null;
  has_condition_offers?: boolean | null;
  stock?: number | null;
  stock_quantity?: number | null;
  manage_stock?: boolean | null;
  low_stock_threshold?: number | null;
  categories?:
    | StorefrontHomeProductDirectCategoryRecord
    | StorefrontHomeProductDirectCategoryRecord[]
    | null;
  product_categories?: StorefrontHomeProductCategoryJoinRecord[] | null;
}

interface StorefrontHomeProductRecencyCandidate {
  id?: string | null;
  categories?:
    | StorefrontHomeProductDirectCategoryRecord
    | StorefrontHomeProductDirectCategoryRecord[]
    | null;
  price?: number | string | null;
  updated_at?: string | null;
}

interface StorefrontHomeProductsQuery
  extends PromiseLike<{
    data: StorefrontHomeProduct[] | null;
    error: unknown;
  }> {
  eq(column: string, value: unknown): StorefrontHomeProductsQuery;
  in(column: string, values: readonly string[]): StorefrontHomeProductsQuery;
  limit(count: number): StorefrontHomeProductsQuery;
  not(
    column: string,
    operator: string,
    value: unknown
  ): StorefrontHomeProductsQuery;
  or(
    filters: string,
    options?: { referencedTable?: string }
  ): StorefrontHomeProductsQuery;
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean }
  ): StorefrontHomeProductsQuery;
}

interface StorefrontHomeProductsTable {
  select(columns: string): StorefrontHomeProductsQuery;
}

function storefrontHomeProductsTable(
  supabase: SupabaseClient
): StorefrontHomeProductsTable {
  // Keep the runtime Supabase query builder while avoiding type-level parsing of
  // several large nested select strings on every web typecheck. Result shape is
  // still explicitly represented by StorefrontHomeProduct above and covered by
  // the home-product adapter/query tests.
  return supabase.from('products') as unknown as StorefrontHomeProductsTable;
}

const HOME_HANDSET_CATEGORY_KEYWORDS = ['smartphone', 'mobile', 'phone'];
const HOME_HANDSET_EXCLUDED_CATEGORY_TERMS = [
  'headphone',
  'earphone',
  'microphone',
  'case',
  'charger',
  'cable',
  'cover',
  'protector',
  'accessor',
];

function getHomeProductRecencyTime(
  product: StorefrontHomeProductRecencyCandidate
): number {
  if (!product.updated_at) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(product.updated_at);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function getHomeProductPrice(
  product: StorefrontHomeProductRecencyCandidate
): number {
  const price = Number(product.price ?? 0);
  return Number.isFinite(price) ? price : 0;
}

function compareHomeProductRecency<
  T extends StorefrontHomeProductRecencyCandidate,
>(first: T, second: T): number {
  const firstUpdatedAt = getHomeProductRecencyTime(first);
  const secondUpdatedAt = getHomeProductRecencyTime(second);

  if (firstUpdatedAt !== secondUpdatedAt) {
    if (firstUpdatedAt === Number.NEGATIVE_INFINITY) return 1;
    if (secondUpdatedAt === Number.NEGATIVE_INFINITY) return -1;
    return secondUpdatedAt - firstUpdatedAt;
  }

  return getHomeProductPrice(second) - getHomeProductPrice(first);
}

function getHomeProductDirectCategories(
  product: StorefrontHomeProductRecencyCandidate
): StorefrontHomeProductDirectCategoryRecord[] {
  const directCategories = product.categories;
  if (!directCategories) {
    return [];
  }

  return (
    Array.isArray(directCategories) ? directCategories : [directCategories]
  ).filter(
    (category): category is StorefrontHomeProductDirectCategoryRecord =>
      !!category && typeof category === 'object'
  );
}

function homeCategoryMatchesHandset(
  category: StorefrontHomeProductDirectCategoryRecord
): boolean {
  const candidates = [category.name, category.slug].filter(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim().length > 0
  );

  return candidates.some((candidate) => {
    const normalized = candidate.toLowerCase().trim();
    return (
      HOME_HANDSET_CATEGORY_KEYWORDS.some((keyword) =>
        normalized.includes(keyword)
      ) &&
      !HOME_HANDSET_EXCLUDED_CATEGORY_TERMS.some((term) =>
        normalized.includes(term)
      )
    );
  });
}

function allowsRelationBackedHomePhonePriority(
  product: StorefrontHomeProductRecencyCandidate
): boolean {
  const directCategories = getHomeProductDirectCategories(product);
  return (
    directCategories.length === 0 ||
    directCategories.some(homeCategoryMatchesHandset)
  );
}

/**
 * Ordering strategy for the storefront home product grid.
 * - 'price': highest price first (default for all storefronts).
 * - 'recent': most recently updated first (opt-in, e.g. OgaBassey).
 */
export type StorefrontHomeProductSort = 'price' | 'recent';

const STOREFRONT_HOME_PRODUCT_LIMIT = 50;
const STOREFRONT_HOME_PRIORITY_PRODUCT_LIMIT = 24;
const STOREFRONT_HOME_PRODUCT_SELECT = `
    id, name, slug, description, price, compare_at_price, created_at,
    images, category, brand, condition, has_condition_offers, stock, stock_quantity,
    manage_stock, low_stock_threshold,
    product_categories(categories(name, slug))
  `;
const STOREFRONT_HOME_PRODUCT_RECENT_SELECT = `
    id, name, slug, description, price, compare_at_price, created_at, updated_at,
    images, category, brand, condition, has_condition_offers, stock, stock_quantity,
    manage_stock, low_stock_threshold,
    categories:category_id(id, name, slug, parent_id),
    product_categories(categories(name, slug))
  `;
const STOREFRONT_HOME_PRODUCT_DIRECT_CATEGORY_SELECT = `
    id, name, slug, description, price, compare_at_price, created_at, updated_at,
    images, category, brand, condition, has_condition_offers, stock, stock_quantity,
    manage_stock, low_stock_threshold,
    categories:category_id!inner(id, name, slug, parent_id),
    product_categories(categories(name, slug))
  `;
const STOREFRONT_HOME_PRODUCT_RELATION_CATEGORY_SELECT = `
    id, name, slug, description, price, compare_at_price, created_at, updated_at,
    images, category, brand, condition, has_condition_offers, stock, stock_quantity,
    manage_stock, low_stock_threshold,
    categories:category_id(id, name, slug, parent_id),
    product_categories!inner(categories!inner(name, slug))
  `;

/**
 * Remote-cached launch-carousel candidate window ordered by creation time, not
 * edits. OgaBassey uses this for the product-driven hero so an old product
 * update can never eject a genuinely new launch before the carousel pin/cap
 * logic runs, while product mutations stay shared across Vercel instances.
 */
export async function getCachedStorefrontLaunchProducts(
  merchantId: string
): Promise<StorefrontHomeProduct[]> {
  'use cache: remote';
  cacheLife('products');
  cacheTag(
    'products',
    `products-${merchantId}`,
    `products-launch-${merchantId}-created`
  );

  const supabase = getPublicSupabaseClient();
  const productsTable = storefrontHomeProductsTable(supabase);
  const { data, error } = await productsTable
    .select(STOREFRONT_HOME_PRODUCT_RECENT_SELECT)
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('price', { ascending: false })
    .limit(STOREFRONT_HOME_PRODUCT_LIMIT);

  if (error) {
    console.error('Failed to load storefront launch products', {
      merchantId,
      error,
    });
    throw error;
  }

  return hydrateAndSanitizeProducts(supabase, merchantId, data ?? []);
}

/**
 * Remote-cached storefront homepage products.
 * Uses the products cacheLife profile plus shared and sort-specific product
 * tags so revalidateProducts() can bust every home-product ordering across
 * Vercel instances.
 */
export async function getCachedStorefrontHomeProducts(
  merchantId: string,
  sort: StorefrontHomeProductSort = 'price'
): Promise<StorefrontHomeProduct[]> {
  'use cache: remote';
  cacheLife('products');
  cacheTag(
    'products',
    `products-${merchantId}`,
    `products-home-${merchantId}-${sort}`
  );

  const supabase = getPublicSupabaseClient();
  const productsTable = storefrontHomeProductsTable(supabase);
  const buildHandsetCategoryClause = (
    column: 'name' | 'slug',
    keyword: string
  ) =>
    [
      `${column}.ilike.%${keyword}%`,
      ...HOME_HANDSET_EXCLUDED_CATEGORY_TERMS.map(
        (term) => `${column}.not.ilike.%${term}%`
      ),
    ].join(',');
  const handsetCategoryClauses = HOME_HANDSET_CATEGORY_KEYWORDS.flatMap(
    (keyword) => [
      `and(${buildHandsetCategoryClause('name', keyword)})`,
      `and(${buildHandsetCategoryClause('slug', keyword)})`,
    ]
  ).join(',');

  // 'recent' surfaces the most recently updated devices first. `updated_at` is
  // trigger-maintained on every row update, with price as a stable tiebreaker.
  // It fetches phone candidates separately before the general recent window so
  // the downstream phone-first homepage slice cannot lose older smartphones to
  // the database LIMIT.
  if (sort === 'recent') {
    let phoneCandidatesQuery = productsTable
      .select(STOREFRONT_HOME_PRODUCT_RECENT_SELECT)
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .or(
        'category.ilike.%smartphone%,category.ilike.%mobile%,category.ilike.%phone%'
      );
    for (const excludedTerm of HOME_HANDSET_EXCLUDED_CATEGORY_TERMS) {
      phoneCandidatesQuery = phoneCandidatesQuery.not(
        'category',
        'ilike',
        `%${excludedTerm}%`
      );
    }
    phoneCandidatesQuery = phoneCandidatesQuery
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('price', { ascending: false })
      .limit(STOREFRONT_HOME_PRIORITY_PRODUCT_LIMIT);

    const directCategoryPhoneCandidatesQuery = productsTable
      .select(STOREFRONT_HOME_PRODUCT_DIRECT_CATEGORY_SELECT)
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .or(handsetCategoryClauses, { referencedTable: 'categories' })
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('price', { ascending: false })
      .limit(STOREFRONT_HOME_PRIORITY_PRODUCT_LIMIT);

    const relationPhoneCandidatesQuery = productsTable
      .select(STOREFRONT_HOME_PRODUCT_RELATION_CATEGORY_SELECT)
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .or(handsetCategoryClauses, {
        referencedTable: 'product_categories.categories',
      })
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('price', { ascending: false })
      .limit(STOREFRONT_HOME_PRIORITY_PRODUCT_LIMIT);

    const recentProductsQuery = productsTable
      .select(STOREFRONT_HOME_PRODUCT_RECENT_SELECT)
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('price', { ascending: false })
      .limit(STOREFRONT_HOME_PRODUCT_LIMIT);

    // Keep these awaits sequential instead of Promise.all: a cold shared-cache
    // miss should not spend four PostgREST/Postgres connections at once for
    // one homepage request.
    const { data: phoneCandidates, error: phoneCandidatesError } =
      await phoneCandidatesQuery;
    if (phoneCandidatesError) {
      console.error('Failed to load storefront home products', {
        merchantId,
        error: phoneCandidatesError,
      });
      throw phoneCandidatesError;
    }

    const {
      data: directCategoryPhoneCandidates,
      error: directCategoryPhoneCandidatesError,
    } = await directCategoryPhoneCandidatesQuery;
    if (directCategoryPhoneCandidatesError) {
      console.error('Failed to load storefront home products', {
        merchantId,
        error: directCategoryPhoneCandidatesError,
      });
      throw directCategoryPhoneCandidatesError;
    }

    const {
      data: relationPhoneCandidates,
      error: relationPhoneCandidatesError,
    } = await relationPhoneCandidatesQuery;
    if (relationPhoneCandidatesError) {
      console.error('Failed to load storefront home products', {
        merchantId,
        error: relationPhoneCandidatesError,
      });
      throw relationPhoneCandidatesError;
    }

    const { data: recentProducts, error: recentProductsError } =
      await recentProductsQuery;
    if (recentProductsError) {
      console.error('Failed to load storefront home products', {
        merchantId,
        error: recentProductsError,
      });
      throw recentProductsError;
    }

    const scopedRelationPhoneCandidates = (
      relationPhoneCandidates ?? []
    ).filter(allowsRelationBackedHomePhonePriority);
    const phonePriorityProducts = [
      ...(phoneCandidates ?? []),
      ...(directCategoryPhoneCandidates ?? []),
      ...scopedRelationPhoneCandidates,
    ].sort(compareHomeProductRecency);
    const seenProductIds = new Set<string>();
    const combinedProducts = [
      ...phonePriorityProducts,
      ...(recentProducts ?? []),
    ]
      .filter((product) => {
        if (!product?.id || seenProductIds.has(product.id)) {
          return false;
        }
        seenProductIds.add(product.id);
        return true;
      })
      .slice(0, STOREFRONT_HOME_PRODUCT_LIMIT);

    return hydrateAndSanitizeProducts(supabase, merchantId, combinedProducts);
  }

  // 'price' (the default for all other storefronts) keeps the original
  // highest-price-first ordering.
  const { data, error } = await productsTable
    .select(STOREFRONT_HOME_PRODUCT_SELECT)
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .order('price', { ascending: false })
    .limit(STOREFRONT_HOME_PRODUCT_LIMIT);

  if (error) {
    console.error('Failed to load storefront home products', {
      merchantId,
      error,
    });
    throw error;
  }

  return hydrateAndSanitizeProducts(supabase, merchantId, data ?? []);
}

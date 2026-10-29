import {
  deriveProductImageData,
  getImagePayloadAlt,
  getImagePayloadUrl,
} from '@baci/shared/lib/product-image-alt';
import { prioritizeSmartphoneProducts } from '@baci/shared/storefront/prioritize-smartphone-products';
import type { Product as StorefrontProduct } from '@/lib/products';
import {
  COMPACT_OPTIONS,
  type CurrencyConfig,
  formatCurrencyWithConfig,
} from '@/lib/currency';
import { stripHtmlTags } from '@/lib/sanitize-core';
import {
  OGABASSEY_HOME_PRODUCT_DESCRIPTION_TEASER_LIMIT,
  OGABASSEY_HOME_PRODUCT_FEED_LIMIT,
} from './config/products';
import type { Product as OgabasseyProduct } from './types';

type ConditionLabel = 'New' | 'Used' | 'Open Box' | 'New & Used';

const CONDITION_LABELS: Record<string, ConditionLabel> = {
  open_box: 'Open Box',
  new: 'New',
  used: 'Used',
};

/**
 * Platform-default currency for the home product feed — Baci's home market
 * (NGN) — used whenever a caller doesn't have a merchant-resolved currency to
 * hand (e.g. template preview mocks). Multi-tenant callers should pass the
 * merchant's resolved `CurrencyConfig` from `resolveMerchantCurrencyConfig`
 * instead of relying on this fallback.
 */
const DEFAULT_HOME_FEED_CURRENCY: CurrencyConfig = {
  code: 'NGN',
  symbol: '₦',
  locale: 'en-NG',
};

const PRICE_QUESTION_PATTERN = /What is the .*? Price in Nigeria\??/i;

const mapCondition = (condition?: string): ConditionLabel => {
  return CONDITION_LABELS[condition || ''] || 'New';
};

// Home cards render at most a 60-char teaser (ProductGridItemChrome), so the
// full PDP description must not cross the server->client boundary — it is the
// single largest contributor to the home RSC flight payload.
const buildDescriptionTeaser = (description?: string | null): string => {
  return stripHtmlTags(description ?? '')
    .replace(PRICE_QUESTION_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, OGABASSEY_HOME_PRODUCT_DESCRIPTION_TEASER_LIMIT);
};

// getMatchingImagePayloadAlt only ever reads url+alt pairs with a non-blank
// alt, so alt-less entries and extra payload fields are dead weight in the
// serialized feed.
const slimImagePayloads = (
  imagePayloads: readonly unknown[]
): { url: string; alt: string }[] => {
  return imagePayloads
    .map((payload) => ({
      url: getImagePayloadUrl(payload),
      alt: getImagePayloadAlt(payload),
    }))
    .filter((payload) => payload.url !== '' && payload.alt !== '');
};

interface MapOgabasseyProductsOptions {
  /**
   * 'teaser' (default) truncates descriptions for feeds that cross the
   * server->client boundary. Use 'full' for server-only consumers (launch
   * carousel/JSON-LD) where truncation would alter schema markup.
   */
  descriptionMode?: 'teaser' | 'full';
  /**
   * Whether to serialize multi-image gallery arrays (`images` and
   * `image_payloads`). Defaults to `true` for listing/detail callers; the
   * 24-card homepage feed passes `false` because homepage cards only render
   * the primary `image` + `image_alt` and have no color-swatch image switching.
   */
  includeGalleryImages?: boolean;
}

export function mapStorefrontProductsToOgabasseyProducts(
  storefrontProducts: StorefrontProduct[],
  currency: CurrencyConfig = DEFAULT_HOME_FEED_CURRENCY,
  {
    descriptionMode = 'teaser',
    includeGalleryImages = true,
  }: MapOgabasseyProductsOptions = {}
): OgabasseyProduct[] {
  return storefrontProducts.map((product) => {
    const {
      image,
      imageAlt,
      imagePayloads,
      images,
    } = deriveProductImageData({
      image: product.image,
      images: product.images ?? [],
    });

    const category =
      Array.isArray(product.categories) ? product.categories[0] : product.categories;
    const categorySlug = category?.slug || product.category_slug;
    const condition: ConditionLabel = product.has_condition_offers
      ? 'New & Used'
      : mapCondition(product.condition);
    const altImagePayloads = includeGalleryImages
      ? slimImagePayloads(imagePayloads)
      : [];
    const primaryStorage = product.storage_options?.[0];

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      price: formatCurrencyWithConfig(product.price, currency, COMPACT_OPTIONS),
      rawPrice: product.price,
      image,
      ...(imageAlt ? { image_alt: imageAlt } : {}),
      ...(includeGalleryImages && altImagePayloads.length > 0
        ? { image_payloads: altImagePayloads }
        : {}),
      description:
        descriptionMode === 'full'
          ? product.description
          : buildDescriptionTeaser(product.description),
      ...(typeof product.rating === 'number' &&
      Number.isFinite(product.rating) &&
      product.rating > 0
        ? { rating: product.rating }
        : {}),
      category: category?.name || product.category || 'General',
      ...(product.category_id ? { category_id: product.category_id } : {}),
      ...(categorySlug ? { categorySlug } : {}),
      condition,
      // The deferred home-card chrome uses this flag to route mixed-condition
      // products to PDP option selection instead of ambiguous quick-add.
      ...(product.has_condition_offers
        ? { has_condition_offers: true }
        : {}),
      ...(product.brand ? { brand: product.brand } : {}),
      ...(includeGalleryImages &&
      product.colors &&
      product.colors.length > 0
        ? { colors: product.colors }
        : {}),
      ...(primaryStorage ? { storage: primaryStorage } : {}),
      ...(includeGalleryImages ? { images } : {}),
    };
  });
}

export function createOgabasseyHomeProductFeed(
  storefrontProducts: StorefrontProduct[],
  currency: CurrencyConfig = DEFAULT_HOME_FEED_CURRENCY
): OgabasseyProduct[] {
  return mapStorefrontProductsToOgabasseyProducts(
    prioritizeSmartphoneProducts(storefrontProducts).slice(
      0,
      OGABASSEY_HOME_PRODUCT_FEED_LIMIT
    ),
    currency,
    { includeGalleryImages: false }
  );
}

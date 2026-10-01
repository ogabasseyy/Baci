import {
  getEffectiveProductStock,
  getProductStockBucket,
  toSchemaItemConditionUri,
} from '@baci/shared/lib';
import type { Metadata, Route } from 'next';
import type {
  BreadcrumbList,
  CollectionPage,
  MerchantReturnPolicy,
  OfferShippingDetails,
  ReturnFeesEnumeration,
  ReturnMethodEnumeration,
  WithContext,
} from 'schema-dts';
import { filterBrandMatchedSocialProfiles } from '@/lib/brand-matched-social-profiles';
import type { JsonLdStructuredData } from '@/lib/json-ld-types';
import { buildStorefrontProductPath } from './build-storefront-product-path';
import {
  type CheckoutPaymentMerchant,
  isBankTransferCheckoutAvailable,
  isKorapayCheckoutAvailable,
  isPayOnDeliveryCheckoutAvailable,
  isPaystackCheckoutAvailable,
} from './checkout/payment-gateway-availability';
import { collectProductSchemaSpecProperties } from './collect-product-schema-spec-properties';
import { generateStorefrontSlug } from './generate-storefront-slug';
import {
  isExternalPlaceholderImageUrl,
  PLACEHOLDER_IMAGE,
} from './image-utils';
import { generateMetaDescription } from './meta-description';
import { normalizeOgabasseyCdnImageUrl } from './ogabassey-cdn-image-url';
import { getProductSchemaSpecKeyForPropertyId } from './product-schema-spec-vocabulary';
import { shouldIncludeProductSchemaSpec } from './product-schema-specs';
import type {
  Product,
  ProductSchemaMarkup,
  ProductVariant,
  Review,
} from './products';
// Import from sanitize-core to avoid loading jsdom on server components
import { escapeHtml, stripHtmlTags } from './sanitize-core';
import { sanitizeSchemaMarkup, sanitizeSchemaUrl } from './sanitize-json-ld';
import { normalizeSocialUrl } from './social';
import { resolveStorefrontProductCategoryName } from './storefront-product-category-name';
import { getValidatedProductUrl as getSerializedValidatedProductUrl } from './storefront-product-url-serialization';
import { isUnsupportedSpecValue } from './storefront-specs/is-unsupported-spec-value';
import type {
  MerchantTrustProfile,
  MerchantTrustProfileReturnFee,
  MerchantTrustProfileReturnMethod,
} from './storefront-trust/merchant-trust-profile-types';

export { generateStorefrontSlug as generateSlug } from './generate-storefront-slug';
// Re-export escapeHtml for use in other modules
export { escapeHtml, generateMetaDescription, getEffectiveProductStock };

function getSchemaItemCondition(condition?: string | null) {
  if (!condition || condition.trim() === '') {
    return 'https://schema.org/NewCondition';
  }

  return toSchemaItemConditionUri(condition);
}

function getSchemaAvailability(product: {
  manage_stock?: boolean | null;
  stock?: number | string | null;
  stock_quantity?: number | string | null;
  low_stock_threshold?: number | string | null;
}) {
  return getProductStockBucket(product) === 'out_of_stock'
    ? 'https://schema.org/OutOfStock'
    : 'https://schema.org/InStock';
}

/**
 * Generates a full product slug including condition
 * Examples:
 *   - "iPhone 12" (new) → "iphone-12-new"
 *   - "iPhone 12" (used) → "iphone-12-used"
 *   - "iPhone 12" (refurbished) → "iphone-12-refurbished"
 *   - "iPhone 12" (no condition) → "iphone-12"
 */
export function generateProductSlug(
  name: string,
  _condition?: 'new' | 'used' | string,
  _conditionDetail?: string
): string {
  // Phase 7: Condition Deduplication
  // We no longer inject condition into the slug. Slugs should be unique to the PRODUCT FAMILY (e.g. "iphone-12")
  // The condition is handled via query params or internal product logic.
  // We strip common condition suffixes from the name if they exist, to ensure clean slugs.
  let cleanName = name;
  const lowerName = name.toLowerCase();

  // Basic cleanup of condition terms if they are part of the name
  if (lowerName.endsWith(' (new)')) cleanName = name.slice(0, -6);
  else if (lowerName.endsWith(' (used)')) cleanName = name.slice(0, -7);
  else if (lowerName.endsWith(' new')) cleanName = name.slice(0, -4);
  else if (lowerName.endsWith(' used')) cleanName = name.slice(0, -5);

  return generateStorefrontSlug(cleanName);
}

/**
 * Builds the product URL path based on available data
 * Priority:
 *   1. /{category}/{product-slug} (if category exists)
 *   2. /products/{product-slug} (fallback)
 *
 * Examples:
 *   - smartphones, "iphone-12-used" → "/smartphones/iphone-12-used"
 *   - null, "generic-item" → "/products/generic-item"
 *
 * @param productSlug The product slug
 * @param category Category object with name/slug, or legacy TEXT category string
 * @param categorySlug Category slug (for backward compatibility)
 */
export function buildProductUrl(
  productSlug: string,
  category?: string | null | { name?: string; slug?: string },
  categorySlug?: string | null
): Route {
  return buildStorefrontProductPath(productSlug, category, categorySlug);
}

/**
 * Generates the full product URL path from product data.
 * Sourced from the dependency-free `product-url` module so hot client paths
 * can import it without pulling the sanitize toolchain.
 */
import { getProductUrl } from './product-url';

export { getProductUrl };

export function getValidatedProductUrl(
  product: Parameters<typeof getProductUrl>[0],
  baseUrl: string,
  merchantSlug?: string | null
): string {
  return getSerializedValidatedProductUrl(product, baseUrl, merchantSlug);
}

/**
 * Weight unit mapping to schema.org unit codes
 */
const WEIGHT_UNIT_CODES: Record<string, string> = {
  kg: 'KGM',
  lb: 'LBR',
  g: 'GRM',
  oz: 'ONZ',
};

/**
 * Dimension unit mapping to schema.org unit codes
 */
const DIMENSION_UNIT_CODES: Record<string, string> = {
  in: 'INH',
  m: 'MTR',
  cm: 'CMT',
};

/**
 * Number of milliseconds in a day
 */
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Number of milliseconds in 30 days
 */
const THIRTY_DAYS_MS = 30 * MILLISECONDS_PER_DAY;

/**
 * Maps common variant attribute keys to Google-supported variesBy property URLs.
 * Google only recognizes 6 specific values for variesBy:
 * color, size, suggestedAge, suggestedGender, material, pattern
 * Unsupported attributes return undefined and are excluded from variesBy.
 * @see https://developers.google.com/search/docs/appearance/structured-data/product#product-variants
 */
function schemaPropertyForAttribute(key: string): string | undefined {
  const map: Record<string, string> = {
    color: 'https://schema.org/color',
    colour: 'https://schema.org/color',
    size: 'https://schema.org/size',
    storage: 'https://schema.org/size',
    ram: 'https://schema.org/size',
    material: 'https://schema.org/material',
    pattern: 'https://schema.org/pattern',
    age: 'https://schema.org/suggestedAge',
    gender: 'https://schema.org/suggestedGender',
  };
  return map[key.toLowerCase()];
}

function getNormalizedVariantAttribute(
  attributes: Record<string, string> | null | undefined,
  keys: string[]
): string | undefined {
  if (!attributes) {
    return undefined;
  }

  for (const key of keys) {
    const matchedKey =
      key in attributes
        ? key
        : Object.keys(attributes).find(
            (attributeKey) => attributeKey.toLowerCase() === key.toLowerCase()
          );
    const value = matchedKey ? attributes[matchedKey] : undefined;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function getVariantSchemaColor(
  attributes: Record<string, string> | null | undefined
): string | undefined {
  return getNormalizedVariantAttribute(attributes, ['color', 'colour']);
}

function getVariantSchemaSize(
  attributes: Record<string, string> | null | undefined
): string | undefined {
  const explicitSize = getNormalizedVariantAttribute(attributes, ['size']);
  if (explicitSize) {
    return explicitSize;
  }

  const inferredParts = [
    getNormalizedVariantAttribute(attributes, ['storage']),
    getNormalizedVariantAttribute(attributes, ['ram']),
  ].filter((value): value is string => Boolean(value));

  if (inferredParts.length === 0) {
    return undefined;
  }

  return Array.from(new Set(inferredParts)).join(' / ');
}

function mapReturnMethodToSchemaUrl(
  returnMethod: MerchantTrustProfileReturnMethod | undefined
): ReturnMethodEnumeration | undefined {
  switch (returnMethod) {
    case 'mail':
    case 'carrier_dropoff':
      return 'https://schema.org/ReturnByMail';
    case 'in_store':
      return 'https://schema.org/ReturnInStore';
    default:
      return undefined;
  }
}

function mapReturnFeeToSchemaUrl(
  returnFees: MerchantTrustProfileReturnFee | undefined
): ReturnFeesEnumeration | undefined {
  switch (returnFees) {
    case 'free':
      return 'https://schema.org/FreeReturn';
    case 'customer_pays':
      return 'https://schema.org/ReturnShippingFees';
    case 'original_shipping_deducted':
      return 'https://schema.org/OriginalShippingFees';
    default:
      return undefined;
  }
}

function buildSameAsUrls(
  data: OrganizationData,
  trustProfile?: MerchantTrustProfile
): string[] {
  const sameAs = new Set<string>();

  for (const url of Object.values(trustProfile?.socialLinks ?? {})) {
    const normalized = url.trim();
    if (normalized) {
      sameAs.add(normalized);
    }
  }

  if (data.socialMedia) {
    const socialMediaEntries = [
      ['facebook', data.socialMedia.facebook],
      ['instagram', data.socialMedia.instagram],
      ['twitter', data.socialMedia.twitter],
      ['linkedin', data.socialMedia.linkedin],
      ['youtube', data.socialMedia.youtube],
    ] as const;

    for (const [platform, handle] of socialMediaEntries) {
      const normalized = normalizeSocialUrl(handle, platform);
      if (normalized) {
        sameAs.add(normalized);
      }
    }
  }

  return filterBrandMatchedSocialProfiles(data.name, sameAs).map((url) =>
    escapeHtml(url)
  );
}

function buildContactPoint(
  data: OrganizationData,
  trustProfile?: MerchantTrustProfile
): Record<string, unknown> | undefined {
  const email = trustProfile?.supportEmail ?? data.email;
  const telephone = trustProfile?.supportPhone ?? data.telephone;

  if (!email && !telephone) {
    return undefined;
  }

  return {
    '@type': 'ContactPoint',
    contactType: 'customer service',
    ...(email && { email: escapeHtml(email) }),
    ...(telephone && { telephone: escapeHtml(telephone) }),
    availableLanguage: 'English',
  };
}

function buildMerchantReturnPolicy(
  country: string,
  trustProfile?: MerchantTrustProfile,
  fallbackDays = 7
): MerchantReturnPolicy {
  const returnPolicy = trustProfile?.returnPolicy;

  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: country,
    returnPolicyCountry: country,
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: returnPolicy?.windowDays ?? fallbackDays,
    returnMethod:
      mapReturnMethodToSchemaUrl(returnPolicy?.returnMethod) ??
      'https://schema.org/ReturnInStore',
    returnFees:
      mapReturnFeeToSchemaUrl(returnPolicy?.returnFees) ??
      'https://schema.org/FreeReturn',
  };
}

function buildOfferShippingDetails(
  country: string,
  currency: string,
  trustProfile?: MerchantTrustProfile
): OfferShippingDetails {
  const shippingPolicy = trustProfile?.shippingPolicy;
  const handlingMin = shippingPolicy?.handlingDaysMin ?? 0;
  const handlingMax = shippingPolicy?.handlingDaysMax ?? 1;
  const transitMin = shippingPolicy?.transitDaysMin ?? 1;
  const transitMax = shippingPolicy?.transitDaysMax ?? 5;

  return {
    '@type': 'OfferShippingDetails',
    shippingRate: {
      '@type': 'MonetaryAmount',
      value: 0,
      currency,
    },
    shippingDestination: {
      '@type': 'DefinedRegion',
      addressCountry: country,
    },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      handlingTime: {
        '@type': 'QuantitativeValue',
        minValue: handlingMin,
        maxValue: handlingMax,
        unitCode: 'DAY',
      },
      transitTime: {
        '@type': 'QuantitativeValue',
        minValue: transitMin,
        maxValue: transitMax,
        unitCode: 'DAY',
      },
    },
  };
}

function buildMerchantReturnPolicyFromTrustProfile(
  country: string,
  trustProfile?: MerchantTrustProfile
): MerchantReturnPolicy {
  const returnPolicy = trustProfile?.returnPolicy;
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: country,
    returnPolicyCountry: country,
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: returnPolicy?.windowDays ?? 7,
    returnMethod:
      mapReturnMethodToSchemaUrl(returnPolicy?.returnMethod) ??
      'https://schema.org/ReturnInStore',
    returnFees:
      mapReturnFeeToSchemaUrl(returnPolicy?.returnFees) ??
      'https://schema.org/FreeReturn',
  };
}

interface ProductSchemaOptions {
  acceptedPaymentMethods?: readonly string[];
  productUrl?: string;
}

interface StorefrontPaymentGatewayConfig {
  korapayConfigured: boolean;
  paystackConfigured: boolean;
  currency?: string | null;
}

function isPaystackStructuredDataCurrencyAvailable(
  currency: string | null | undefined
): boolean {
  return currency?.trim().toUpperCase() === 'NGN';
}

export function buildStorefrontAcceptedPaymentMethods(
  merchant: CheckoutPaymentMerchant | null | undefined,
  gatewayConfig: StorefrontPaymentGatewayConfig
): string[] {
  const methods = new Set<string>();
  const paystackStructuredDataAvailable =
    gatewayConfig.paystackConfigured &&
    isPaystackStructuredDataCurrencyAvailable(gatewayConfig.currency);

  if (
    paystackStructuredDataAvailable &&
    isPaystackCheckoutAvailable(merchant)
  ) {
    methods.add('Debit and credit card');
    methods.add('USSD');
  }

  if (
    paystackStructuredDataAvailable &&
    isBankTransferCheckoutAvailable(merchant)
  ) {
    methods.add('Bank transfer');
  }

  if (
    gatewayConfig.korapayConfigured &&
    isKorapayCheckoutAvailable(merchant, gatewayConfig.currency)
  ) {
    methods.add('Debit and credit card');
  }

  if (isPayOnDeliveryCheckoutAvailable(merchant)) {
    methods.add('Pay on delivery');
  }

  return [...methods];
}

function normalizeAcceptedPaymentMethods(
  acceptedPaymentMethods: readonly string[] | undefined
): string[] | undefined {
  if (!acceptedPaymentMethods) {
    return undefined;
  }

  const methods = [
    ...new Set(
      acceptedPaymentMethods
        .map((method) => {
          const normalized = method.trim().toLowerCase();
          if (normalized.includes('bank transfer')) {
            return 'https://schema.org/ByBankTransferInAdvance';
          }
          if (
            normalized.includes('cash on delivery') ||
            normalized.includes('pay on delivery')
          ) {
            return 'https://schema.org/COD';
          }
          if (
            normalized.includes('debit') ||
            normalized.includes('credit') ||
            normalized.includes('card')
          ) {
            return 'https://schema.org/CreditCard';
          }
          if (normalized.includes('delivery')) {
            return 'https://schema.org/Cash';
          }
          if (normalized === 'ussd') {
            return 'USSD';
          }
          return '';
        })
        .filter((method) => method.length > 0)
    ),
  ];

  return methods.length > 0 ? methods : undefined;
}

function parseStructuredDataUrl(url: string | undefined): URL | undefined {
  if (!url) {
    return undefined;
  }

  const sanitizedUrl = sanitizeSchemaUrl(url);
  if (!sanitizedUrl) {
    return undefined;
  }

  try {
    return new URL(sanitizedUrl);
  } catch {
    return undefined;
  }
}

function buildStructuredDataVariantUrl(
  productUrl: URL | undefined,
  variant: ProductVariant
): string | undefined {
  if (!productUrl) {
    return undefined;
  }

  const url = new URL(productUrl);
  url.searchParams.set('variantId', variant.id);

  return url.toString();
}

function parseSchemaNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function hasValidAggregateRatingSchema(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const aggregateRating = value as {
    bestRating?: unknown;
    ratingCount?: unknown;
    ratingValue?: unknown;
    reviewCount?: unknown;
    worstRating?: unknown;
  };

  const ratingValue = parseSchemaNumber(aggregateRating.ratingValue);
  const bestRating =
    aggregateRating.bestRating === undefined ||
    aggregateRating.bestRating === null
      ? 5
      : parseSchemaNumber(aggregateRating.bestRating);
  const worstRating =
    aggregateRating.worstRating === undefined ||
    aggregateRating.worstRating === null
      ? 1
      : parseSchemaNumber(aggregateRating.worstRating);
  const reviewCount = parseSchemaNumber(aggregateRating.reviewCount) ?? 0;
  const ratingCount = parseSchemaNumber(aggregateRating.ratingCount) ?? 0;

  if (
    ratingValue === undefined ||
    bestRating === undefined ||
    worstRating === undefined ||
    worstRating !== 1 ||
    bestRating !== 5
  ) {
    return false;
  }

  return (
    ratingValue >= worstRating &&
    ratingValue <= bestRating &&
    (reviewCount > 0 || ratingCount > 0)
  );
}

function sanitizeCustomProductSchemaMarkup(
  schemaMarkup: Product['schema_markup']
): Record<string, unknown> {
  const sanitized = sanitizeSchemaMarkup(schemaMarkup);
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    return {};
  }

  const sanitizedSchema = { ...sanitized } as Record<string, unknown>;

  if (
    'aggregateRating' in sanitizedSchema &&
    !hasValidAggregateRatingSchema(sanitizedSchema.aggregateRating)
  ) {
    delete sanitizedSchema.aggregateRating;
  }

  return sanitizedSchema;
}

/**
 * Generates JSON-LD structured data for a product (2025 Google best practices)
 * For products with variants, outputs @type ProductGroup with hasVariant (each variant has its own Offer).
 * All user-controlled string values are sanitized to prevent XSS attacks.
 * @see https://developers.google.com/search/docs/appearance/structured-data/product
 */
export function generateProductSchema(
  product: Product,
  merchantName: string = 'Baci Store',
  currency: string = 'USD',
  country: string = 'NG', // Default to Nigeria
  merchantLogo?: string,
  trustProfile?: MerchantTrustProfile,
  options: ProductSchemaOptions = {}
): ProductSchemaMarkup & Record<string, unknown> {
  // Keep schema values as data. safeJsonLdStringify handles script-context escaping
  // at serialization time so structured-data parsers receive unmodified values.
  const safeName = product.name;

  // Product schema should describe the product itself, not repeat a short
  // search-snippet template. Prefer the enriched visible description and use
  // the meta description only when the visible description sanitizes empty.
  const productDescription = product.description
    ? generateMetaDescription(product.description, 500)
    : '';
  const metaDescription = product.meta_description
    ? generateMetaDescription(product.meta_description, 500)
    : '';
  const visibleDescriptionSupported =
    productDescription && !isUnsupportedSpecValue(productDescription);
  const safeDescription = visibleDescriptionSupported
    ? productDescription
    : metaDescription
      ? metaDescription
      : `Buy ${safeName} from ${merchantName}. Best prices, fast delivery, and secure payments.`;

  const safeBrand = product.brand || merchantName;
  const safeMerchantName = merchantName;
  const structuredDataProductUrl = parseStructuredDataUrl(options.productUrl);
  const acceptedPaymentMethod = normalizeAcceptedPaymentMethods(
    options.acceptedPaymentMethods
  );
  const shippingDetails = buildOfferShippingDetails(
    country,
    currency,
    trustProfile
  );
  const hasMerchantReturnPolicy = buildMerchantReturnPolicyFromTrustProfile(
    country,
    trustProfile
  );

  // Extract images — handle both {url: string} objects and plain string entries defensively
  let safeImages: string[] = [];
  if (product.images && product.images.length > 0) {
    safeImages = product.images
      .map((img) => {
        const raw = typeof img === 'string' ? img : img?.url;
        return raw || '';
      })
      .filter(Boolean);
  } else if (product.imageLarge) {
    safeImages = [product.imageLarge];
  } else if (product.image) {
    safeImages = [product.image];
  }

  // Filter out any empty strings
  safeImages = safeImages.filter((img) => img.trim() !== '');

  // If no product images exist, use merchant logo as absolute fallback to satisfy Google Merchant requirements
  const finalImages =
    safeImages.length > 0
      ? safeImages
      : merchantLogo
        ? [merchantLogo]
        : undefined;

  const schema: ProductSchemaMarkup & Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: safeName,
    description: safeDescription,
    ...(structuredDataProductUrl && {
      url: structuredDataProductUrl.toString(),
    }),
    ...(finalImages && { image: finalImages }),
    brand: {
      '@type': 'Brand',
      name: safeBrand,
    },
    offers:
      product.offers && product.offers.length > 0
        ? product.offers.map((offer) => ({
            '@type': 'Offer',
            price: offer.price,
            priceCurrency: currency,
            ...(structuredDataProductUrl && {
              url: structuredDataProductUrl.toString(),
            }),
            availability: getSchemaAvailability({
              manage_stock: product.manage_stock,
              stock_quantity: offer.stock_quantity,
            }),
            itemCondition: getSchemaItemCondition(offer.condition),
            seller: {
              '@type': 'Organization',
              name: safeMerchantName,
            },
            ...(acceptedPaymentMethod && { acceptedPaymentMethod }),
            priceValidUntil: new Date(Date.now() + THIRTY_DAYS_MS)
              .toISOString()
              .substring(0, 10),
            shippingDetails,
            hasMerchantReturnPolicy,
          }))
        : {
            '@type': 'Offer',
            price: product.price,
            priceCurrency: currency,
            ...(structuredDataProductUrl && {
              url: structuredDataProductUrl.toString(),
            }),
            availability: getSchemaAvailability(product),
            itemCondition: getSchemaItemCondition(product.condition),
            seller: {
              '@type': 'Organization',
              name: safeMerchantName,
            },
            ...(acceptedPaymentMethod && { acceptedPaymentMethod }),
            priceValidUntil: new Date(Date.now() + THIRTY_DAYS_MS)
              .toISOString()
              .substring(0, 10),
            shippingDetails,
            hasMerchantReturnPolicy,
          },
  };

  // Product identifiers are important for Google Merchant Center.
  if (product.sku) {
    schema.sku = product.sku;
  }

  if (product.gtin) {
    schema.gtin = product.gtin;
    if (product.gtin.length === 13) {
      schema.gtin13 = product.gtin;
    }
    if (product.gtin.length === 14) {
      schema.gtin14 = product.gtin;
    }
  }

  if (product.mpn) {
    schema.mpn = product.mpn;
  }

  // Relation-backed category metadata outranks the deprecated text column.
  const categoryName = resolveStorefrontProductCategoryName(product);
  if (categoryName) {
    schema.category = categoryName;
  }

  // Physical attributes
  if (product.weight_value && product.weight_unit) {
    schema.weight = {
      '@type': 'QuantitativeValue',
      value: product.weight_value,
      unitCode: WEIGHT_UNIT_CODES[product.weight_unit] || 'KGM',
    };
  }

  // Detailed specifications for AI/Crawlers (additionalProperty)
  // This enables rich snippets and voice assistants to answer spec queries.
  const additionalPropertyCollector =
    collectProductSchemaSpecProperties(product);

  // Dimensions
  if (product.dimensions) {
    const dimUnit = DIMENSION_UNIT_CODES[product.dimensions.unit] || 'CMT';
    // Use product.dimensions.depth if available; fallback to length for backwards compatibility.
    // NOTE: Depth and length may represent the same physical dimension depending on historical data models.
    // This fallback ensures older product definitions using 'length' for depth still populate the schema.
    // Consider standardizing on 'depth' in future and updating legacy data accordingly.
    if (product.dimensions.depth) {
      schema.depth = {
        '@type': 'QuantitativeValue',
        value: product.dimensions.depth,
        unitCode: dimUnit,
      };
    } else if (product.dimensions.length) {
      schema.depth = {
        '@type': 'QuantitativeValue',
        value: product.dimensions.length,
        unitCode: dimUnit,
      };
    }
    if (product.dimensions.width) {
      schema.width = {
        '@type': 'QuantitativeValue',
        value: product.dimensions.width,
        unitCode: dimUnit,
      };
    }
    if (product.dimensions.height) {
      schema.height = {
        '@type': 'QuantitativeValue',
        value: product.dimensions.height,
        unitCode: dimUnit,
      };
    }
  }

  // Color (useful for apparel).
  if (product.color) {
    schema.color = product.color;
  }

  // Compare at price (for sales)
  if (
    product.compare_at_price &&
    product.compare_at_price > product.price &&
    schema.offers &&
    !Array.isArray(schema.offers)
  ) {
    schema.offers.priceSpecification = {
      '@type': 'PriceSpecification',
      price: product.price,
      priceCurrency: currency,
      valueAddedTaxIncluded: product.taxable !== false,
    };
  }

  // Add aggregateRating if product has reviews (improves Google rich results)
  // Only add if we have valid rating data to avoid empty/invalid schema
  if (
    product.rating !== undefined &&
    product.rating > 0 &&
    product.review_count !== undefined &&
    product.review_count > 0
  ) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.rating,
      reviewCount: product.review_count,
      bestRating: 5,
      worstRating: 1,
    };
  }

  // Add individual reviews if available - [NEW 2025]
  if (product.reviews && product.reviews.length > 0) {
    // Sort reviews: 5 stars, then 4 stars, etc. (Descending order)
    const sortedReviews = [...product.reviews].sort(
      (a, b) => b.reviewRating - a.reviewRating
    );

    schema.review = sortedReviews.map((review) => ({
      '@type': 'Review',
      author: {
        '@type': 'Person',
        name: review.author,
      },
      datePublished: review.datePublished,
      reviewBody: review.reviewBody,
      reviewRating: {
        '@type': 'Rating',
        ratingValue: review.reviewRating,
        bestRating: '5',
        worstRating: '1',
      },
    }));
  }

  // Merge custom schema markup if provided (e.g. aggregateRating)
  // This allows merchants to extend the auto-generated schema with their own data
  if (product.schema_markup) {
    const sanitizedCustomSchema = sanitizeCustomProductSchemaMarkup(
      product.schema_markup
    );
    const customAdditionalProperty = sanitizedCustomSchema.additionalProperty;
    const customSchemaFields = Object.fromEntries(
      Object.entries(sanitizedCustomSchema).filter(
        ([key]) => key !== 'additionalProperty' && key !== 'description'
      )
    );
    Object.assign(schema, customSchemaFields);

    const customProperties = Array.isArray(customAdditionalProperty)
      ? customAdditionalProperty
      : [customAdditionalProperty];
    for (const property of customProperties) {
      if (
        !property ||
        typeof property !== 'object' ||
        Array.isArray(property)
      ) {
        continue;
      }

      const candidate = property as {
        name?: unknown;
        propertyID?: unknown;
        value?: unknown;
        minValue?: unknown;
        maxValue?: unknown;
      };
      const candidateValue =
        candidate.value ??
        (candidate.minValue !== undefined && candidate.maxValue !== undefined
          ? `${candidate.minValue} to ${candidate.maxValue}`
          : (candidate.minValue ?? candidate.maxValue));
      const propertyId =
        typeof candidate.propertyID === 'string'
          ? candidate.propertyID.trim()
          : undefined;
      const mappedPropertySpecKey = propertyId
        ? getProductSchemaSpecKeyForPropertyId(propertyId)
        : undefined;
      const candidateName =
        typeof candidate.name === 'string' ? candidate.name.trim() : undefined;
      const isPropertyIdOnlyMerchantNegative =
        propertyId &&
        !mappedPropertySpecKey &&
        !candidateName &&
        candidate.value === false;
      if (
        !isPropertyIdOnlyMerchantNegative &&
        !shouldIncludeProductSchemaSpec(product, {
          key: mappedPropertySpecKey,
          label: candidateName,
          value: candidateValue,
        })
      ) {
        continue;
      }

      additionalPropertyCollector.addCustomProperty(property);
    }
  }

  const additionalProperties = additionalPropertyCollector.getProperties();
  if (additionalProperties.length > 0) {
    schema.additionalProperty = additionalProperties;
  } else {
    delete schema.additionalProperty;
  }

  // ProductGroup transformation for products with variants
  // @see https://schema.org/ProductGroup
  if (product.variants && product.variants.length > 0) {
    schema['@type'] = 'ProductGroup';
    schema.productGroupID = product.slug || product.id;

    // Compute variesBy from unique attribute keys across all variants
    const allAttributeKeys = new Set<string>();
    for (const variant of product.variants) {
      if (variant.attributes) {
        for (const key of Object.keys(variant.attributes)) {
          allAttributeKeys.add(key);
        }
      }
    }

    if (allAttributeKeys.size > 0) {
      // Only include Google-supported variesBy values, deduplicated
      const variesBySet = new Set<string>();
      for (const key of allAttributeKeys) {
        const url = schemaPropertyForAttribute(key);
        if (url) variesBySet.add(url);
      }
      if (variesBySet.size > 0) {
        schema.variesBy = Array.from(variesBySet);
      }
    }

    // Shared shipping + return policy for all variant Offers (2026 best practice)
    const variantShippingDetails = buildOfferShippingDetails(
      country,
      currency,
      trustProfile
    );

    const variantReturnPolicy = buildMerchantReturnPolicyFromTrustProfile(
      country,
      trustProfile
    );

    const variantPriceValidUntil = new Date(Date.now() + THIRTY_DAYS_MS)
      .toISOString()
      .substring(0, 10);

    // Build hasVariant array — each variant becomes a @type Product
    schema.hasVariant = product.variants.map((variant) => {
      const variantPrice = variant.price_override ?? product.price;
      const variantUrl = buildStructuredDataVariantUrl(
        structuredDataProductUrl,
        variant
      );
      const variantCondition = getSchemaItemCondition(
        variant.condition ?? product.condition
      );
      const variantColor = getVariantSchemaColor(variant.attributes);
      const variantSize = getVariantSchemaSize(variant.attributes);
      const attrValues = variant.attributes
        ? Object.values(variant.attributes).join(' / ')
        : '';
      const variantName = attrValues ? `${safeName} - ${attrValues}` : safeName;

      // Variant images: use variant-specific images if available, fall back to parent images
      let variantImages: string[] | undefined;
      if (variant.images && variant.images.length > 0) {
        const filtered = variant.images.filter((img) => img.trim() !== '');
        if (filtered.length > 0) variantImages = filtered;
      }

      if (!variantImages) {
        variantImages = finalImages;
      }

      return {
        '@type': 'Product',
        name: variantName,
        description: safeDescription,
        ...(variantUrl && { url: variantUrl }),
        ...(variantImages && { image: variantImages }),
        brand: {
          '@type': 'Brand',
          name: safeBrand,
        },
        inProductGroupWithID: schema.productGroupID,
        ...(variantColor && { color: variantColor }),
        ...(variantSize && { size: variantSize }),
        sku: variant.sku || variant.id,
        ...(product.gtin && { gtin: product.gtin }),
        ...(product.mpn && { mpn: product.mpn }),
        offers: {
          '@type': 'Offer',
          price: variantPrice,
          priceCurrency: currency,
          ...(variantUrl && { url: variantUrl }),
          availability: getSchemaAvailability({
            manage_stock: product.manage_stock,
            stock_quantity: variant.stock_quantity,
          }),
          itemCondition: variantCondition,
          priceValidUntil: variantPriceValidUntil,
          seller: {
            '@type': 'Organization',
            name: safeMerchantName,
          },
          ...(acceptedPaymentMethod && { acceptedPaymentMethod }),
          shippingDetails: variantShippingDetails,
          hasMerchantReturnPolicy: variantReturnPolicy,
        },
      };
    });

    // Per Google guidelines (2026): Do NOT use AggregateOffer for product variants.
    // Offers belong on each individual variant Product in hasVariant, not on ProductGroup.
    // Remove the parent-level Offer since variants carry their own.
    delete schema.offers;
  }

  return schema;
}

/**
 * Generates breadcrumb JSON-LD schema (2025 best practices)
 * All user-controlled string values are sanitized to prevent XSS attacks.
 * @see https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
 */
export interface BreadcrumbItem {
  name: string;
  url: string;
}

export type BreadcrumbJsonLdSchema = WithContext<BreadcrumbList> &
  Record<string, unknown>;

export function generateBreadcrumbSchema(
  items: BreadcrumbItem[]
): BreadcrumbJsonLdSchema {
  const schema: BreadcrumbJsonLdSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => {
      const normalizedUrl =
        toAbsoluteSchemaUrl(item.url, item.url) || item.url.trim() || '/';

      return {
        '@type': 'ListItem',
        position: index + 1,
        name: escapeHtml(item.name),
        item: escapeHtml(normalizedUrl),
      };
    }),
  };

  return schema;
}

/**
 * Generates FAQ schema for product pages with Q&A
 * All user-controlled string values are sanitized to prevent XSS attacks.
 * @see https://developers.google.com/search/docs/appearance/structured-data/faqpage
 */
export interface FAQItem {
  question: string;
  answer: string;
}

/**
 * Generates FAQ schema for products or pages.
 * @see https://developers.google.com/search/docs/appearance/structured-data/faqpage
 */
export function generateFAQSchema(faqs: FAQItem[]): JsonLdStructuredData {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: escapeHtml(faq.question),
      acceptedAnswer: {
        '@type': 'Answer',
        text: escapeHtml(faq.answer),
      },
    })),
  };
}

/**
 * Generates LocalBusiness schema for merchant storefronts
 * All user-controlled string values are sanitized to prevent XSS attacks.
 * @see https://developers.google.com/search/docs/appearance/structured-data/local-business
 */
export interface LocalBusinessData {
  name: string;
  description?: string;
  url: string;
  logo?: string;
  telephone?: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  geo?: {
    latitude: number;
    longitude: number;
    // ...
  };
  openingHours?: string[]; // e.g., ["Mo-Fr 09:00-17:00", "Sa 10:00-14:00"]
  priceRange?: string; // e.g., "$$" or "₦₦"
  socialMedia?: Record<string, string>;
  rating?: {
    ratingValue: number;
    reviewCount: number;
  };
  reviews?: Review[];
}

/**
 * Generates LocalBusiness schema for merchant storefronts.
 * All user-controlled string values are sanitized to prevent XSS attacks.
 * @see https://developers.google.com/search/docs/appearance/structured-data/local-business
 */
export function generateLocalBusinessSchema(
  business: LocalBusinessData
): JsonLdStructuredData {
  const schema: JsonLdStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: escapeHtml(business.name),
    url: escapeHtml(business.url),
  };

  if (business.description) {
    schema.description = escapeHtml(business.description);
  }

  if (business.logo) {
    const safeLogo = escapeHtml(business.logo);
    schema.logo = safeLogo;
    schema.image = safeLogo;
  }

  if (business.telephone) {
    schema.telephone = escapeHtml(business.telephone);
  }

  if (business.email) {
    schema.email = escapeHtml(business.email);
  }

  if (business.address) {
    schema.address = {
      '@type': 'PostalAddress',
      streetAddress: business.address.street
        ? escapeHtml(business.address.street)
        : undefined,
      addressLocality: business.address.city
        ? escapeHtml(business.address.city)
        : undefined,
      addressRegion: business.address.state
        ? escapeHtml(business.address.state)
        : undefined,
      postalCode: business.address.postalCode
        ? escapeHtml(business.address.postalCode)
        : undefined,
      addressCountry: escapeHtml(business.address.country || 'NG'),
    };
  }

  if (business.geo) {
    schema.geo = {
      '@type': 'GeoCoordinates',
      latitude: business.geo.latitude,
      longitude: business.geo.longitude,
    };
  }

  if (business.openingHours) {
    schema.openingHours = business.openingHours.map((h) => escapeHtml(h));
  }

  if (business.priceRange) {
    schema.priceRange = escapeHtml(business.priceRange);
  }

  if (business.socialMedia) {
    const sameAs = filterBrandMatchedSocialProfiles(
      business.name,
      Object.values(business.socialMedia).filter(Boolean)
    ).map((url) => escapeHtml(url));
    if (sameAs.length > 0) {
      schema.sameAs = sameAs;
    }
  }

  // Add AggregateRating if provided
  if (business.rating) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: business.rating.ratingValue,
      reviewCount: business.rating.reviewCount,
      bestRating: '5',
      worstRating: '1',
    };
  }

  // Add Reviews if provided
  if (business.reviews && business.reviews.length > 0) {
    // Sort reviews: 5 stars, then 4 stars, etc. (Descending order)
    const sortedReviews = [...business.reviews].sort(
      (a, b) => b.reviewRating - a.reviewRating
    );

    schema.review = sortedReviews.map((review) => ({
      '@type': 'Review',
      author: {
        '@type': 'Person',
        name: escapeHtml(review.author),
      },
      datePublished: escapeHtml(review.datePublished),
      reviewBody: escapeHtml(review.reviewBody),
      reviewRating: {
        '@type': 'Rating',
        ratingValue: review.reviewRating,
        bestRating: '5',
        worstRating: '1',
      },
    }));
  }

  return schema;
}

/**
 * Ellipsis string and length for meta description truncation
 */
const ELLIPSIS = '...';
const ELLIPSIS_LENGTH = ELLIPSIS.length;
const DEFAULT_MAX_LENGTH = 160;
const DEFAULT_TITLE_MAX_LENGTH = 70;

/**
 * Standard robots policy for indexable public storefront pages.
 */
const STOREFRONT_FILTER_SEARCH_PARAMS: ReadonlyMap<string, string> = new Map([
  ['brand', 'brand'],
  ['brands', 'brand'],
  ['color', 'color'],
  ['colors', 'color'],
  ['condition', 'condition'],
  ['displaySize', 'displaySize'],
  ['q', 'search'],
  ['query', 'search'],
  ['search', 'search'],
  ['displayType', 'displayType'],
  ['graphics', 'graphics'],
  ['maxPrice', 'price'],
  ['minPrice', 'price'],
  ['ram', 'ram'],
  ['simType', 'simType'],
  ['storage', 'storage'],
] as const);

const STOREFRONT_CANONICAL_FILTER_QUERY_KEYS = [
  ['brand', ['brand', 'brands']],
  ['color', ['color', 'colors']],
  ['condition', ['condition']],
  ['displaySize', ['displaySize']],
  ['displayType', ['displayType']],
  ['graphics', ['graphics']],
  ['price', ['minPrice', 'maxPrice']],
  ['ram', ['ram']],
  ['search', ['search', 'q', 'query']],
  ['simType', ['simType']],
  ['storage', ['storage']],
] as const satisfies readonly [string, readonly string[]][];

function getCanonicalStorefrontFilterQueryKey(
  queryKey: string,
  activeFilterKey: string
): string {
  if (activeFilterKey !== 'search') {
    return queryKey;
  }

  return STOREFRONT_FILTER_SEARCH_PARAMS.get(queryKey) ?? queryKey;
}

export type StorefrontRobotsSearchParams = Record<
  string,
  string | string[] | undefined
>;

interface StorefrontFilterMetadataOptions {
  filtersAffectResults?: boolean;
}

function hasSearchParamValue(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => entry.trim() !== '');
  }

  return typeof value === 'string' && value.trim() !== '';
}

function getActiveStorefrontFilterKeys(
  searchParams?: StorefrontRobotsSearchParams
): Set<string> {
  const activeFilters = new Set<string>();

  if (!searchParams) {
    return activeFilters;
  }

  for (const [key, value] of Object.entries(searchParams)) {
    const canonicalFilterKey = STOREFRONT_FILTER_SEARCH_PARAMS.get(key);

    if (canonicalFilterKey && hasSearchParamValue(value)) {
      activeFilters.add(canonicalFilterKey);
    }
  }

  return activeFilters;
}

function countActiveStorefrontFilters(
  searchParams?: StorefrontRobotsSearchParams
): number {
  return getActiveStorefrontFilterKeys(searchParams).size;
}

export function getCanonicalStorefrontFilterSearchParams(
  searchParams?: StorefrontRobotsSearchParams,
  options: StorefrontFilterMetadataOptions = {}
): URLSearchParams {
  const canonicalParams = new URLSearchParams();
  const activeFilterKeys = getActiveStorefrontFilterKeys(searchParams);

  if (
    !searchParams ||
    !options.filtersAffectResults ||
    activeFilterKeys.size !== 1
  ) {
    return canonicalParams;
  }

  const [activeFilterKey] = activeFilterKeys;
  if (!activeFilterKey) {
    return canonicalParams;
  }

  const filterQueryKeys = STOREFRONT_CANONICAL_FILTER_QUERY_KEYS.find(
    ([canonicalFilterKey]) => canonicalFilterKey === activeFilterKey
  )?.[1];

  if (!filterQueryKeys) {
    return canonicalParams;
  }

  for (const queryKey of filterQueryKeys) {
    const value = searchParams[queryKey];

    if (Array.isArray(value)) {
      for (const entry of value) {
        const trimmedEntry = entry.trim();
        if (trimmedEntry) {
          canonicalParams.append(
            getCanonicalStorefrontFilterQueryKey(queryKey, activeFilterKey),
            trimmedEntry
          );
        }
      }
      continue;
    }

    const trimmedValue = value?.trim();
    if (trimmedValue) {
      canonicalParams.append(
        getCanonicalStorefrontFilterQueryKey(queryKey, activeFilterKey),
        trimmedValue
      );
    }
  }

  return canonicalParams;
}

export function getIndexableRobotsMetadata(
  searchParams?: StorefrontRobotsSearchParams,
  options: StorefrontFilterMetadataOptions = {}
): Metadata['robots'] {
  const activeFilterCount = countActiveStorefrontFilters(searchParams);
  const isIndexable =
    activeFilterCount === 0 ||
    (options.filtersAffectResults === true && activeFilterCount <= 1);

  return {
    index: isIndexable,
    follow: true,
    googleBot: {
      index: isIndexable,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  };
}

/**
 * Validates and returns a proper maxLength value for meta description truncation.
 */
function validateMaxLength(value: number): number {
  if (
    typeof value !== 'number' ||
    Number.isNaN(value) ||
    value <= ELLIPSIS_LENGTH
  ) {
    return DEFAULT_MAX_LENGTH;
  }
  return value;
}

function normalizePlainText(value: string): string {
  return stripHtmlTags(value).replace(/\s+/g, ' ').trim();
}

// Unambiguous meta-title separators. A bare hyphen (`-`) is intentionally
// excluded because product names regularly contain internal hyphens
// (e.g. `MacBook-Pro`, `iPhone-256GB`) and treating them as separators
// causes `removeTrailingDuplicateSuffix` to strip legitimate name segments.
// The spaced hyphen ` - ` is handled explicitly below as a separate branch.
const META_TITLE_SEPARATORS = ['|', '–', '—', ':'] as const;
const META_TITLE_SPACED_HYPHEN = ' - ';

function stringsMatchCaseInsensitive(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'base' }) === 0;
}

function getTrailingSeparatedSegment(value: string) {
  const trimmedValue = value.trim();

  let bestIndex = -1;
  let separatorLength = 0;

  for (const separator of META_TITLE_SEPARATORS) {
    const index = trimmedValue.lastIndexOf(separator);
    if (index > bestIndex) {
      bestIndex = index;
      separatorLength = separator.length;
    }
  }

  // Spaced hyphen (` - `) is treated as a separator too, but bare hyphens
  // are ignored so product names with internal hyphens aren't mangled.
  const spacedHyphenIndex = trimmedValue.lastIndexOf(META_TITLE_SPACED_HYPHEN);
  if (spacedHyphenIndex > bestIndex) {
    bestIndex = spacedHyphenIndex;
    separatorLength = META_TITLE_SPACED_HYPHEN.length;
  }

  if (bestIndex === -1) {
    return null;
  }

  const base = trimmedValue.slice(0, bestIndex).trim();
  const suffix = trimmedValue.slice(bestIndex + separatorLength).trim();

  if (!base || !suffix) {
    return null;
  }

  return { base, suffix };
}

function removeTrailingDuplicateSuffix(value: string, suffix: string): string {
  const normalizedSuffix = normalizePlainText(suffix);
  if (!normalizedSuffix) {
    return value;
  }

  let normalizedValue = normalizePlainText(value);

  while (true) {
    const trailingSegment = getTrailingSeparatedSegment(normalizedValue);
    if (
      !trailingSegment ||
      !stringsMatchCaseInsensitive(trailingSegment.suffix, normalizedSuffix)
    ) {
      break;
    }

    const nextValue = trailingSegment.base;
    if (!nextValue || nextValue === normalizedValue) {
      break;
    }
    normalizedValue = nextValue;
  }

  return normalizedValue;
}

/**
 * Generates a normalized SEO title with optional suffix and length cap.
 */
export function generateMetaTitle(
  title: string,
  options?: {
    maxLength?: number;
    suffix?: string;
    fallback?: string;
  }
): string {
  const maxLength = validateMaxLength(
    options?.maxLength ?? DEFAULT_TITLE_MAX_LENGTH
  );
  const fallback = normalizePlainText(options?.fallback || '');
  let normalizedTitle = normalizePlainText(title) || fallback;
  const suffix = normalizePlainText(options?.suffix || '');

  if (!normalizedTitle) {
    normalizedTitle = suffix;
  }

  if (!normalizedTitle) {
    return '';
  }

  if (suffix) {
    const baseTitle = removeTrailingDuplicateSuffix(normalizedTitle, suffix);
    const trailingSegment = getTrailingSeparatedSegment(baseTitle);
    const hasSuffix =
      stringsMatchCaseInsensitive(baseTitle, suffix) ||
      (trailingSegment
        ? stringsMatchCaseInsensitive(trailingSegment.suffix, suffix)
        : false);
    normalizedTitle = hasSuffix ? baseTitle : `${baseTitle} | ${suffix}`;
  }

  if (normalizedTitle.length <= maxLength) {
    return normalizedTitle;
  }

  if (suffix) {
    const normalizedSuffix = normalizePlainText(suffix);
    const suffixFragment = ` | ${normalizedSuffix}`;
    if (normalizedTitle.endsWith(suffixFragment)) {
      const baseTitle = normalizedTitle
        .slice(0, normalizedTitle.length - suffixFragment.length)
        .trim();
      const allowedBaseLength =
        maxLength - suffixFragment.length - ELLIPSIS_LENGTH;

      if (allowedBaseLength > 0) {
        return `${baseTitle.slice(0, allowedBaseLength)}${ELLIPSIS}${suffixFragment}`;
      }
    }
  }

  return `${normalizedTitle.slice(0, maxLength - ELLIPSIS_LENGTH)}${ELLIPSIS}`;
}

/**
 * Generates CollectionPage schema for product listing pages (categories, collections)
 * @see https://schema.org/CollectionPage
 */
export type CollectionPageJsonLdSchema = WithContext<CollectionPage> &
  Record<string, unknown>;

export type CollectionPageProduct = Parameters<typeof getProductUrl>[0] & {
  brand?: string | null;
  description?: string | null;
  gtin?: string | null;
  image?: string | null;
  imageLarge?: string | null;
  low_stock_threshold?: number | string | null;
  manage_stock?: boolean | null;
  mpn?: string | null;
  price: number;
  stock?: number | string | null;
  stock_quantity?: number | string | null;
};

export interface CollectionPageData {
  name: string;
  description?: string;
  url: string;
  products: CollectionPageProduct[];
  merchantName: string;
  currency?: string;
  country?: string;
  trustProfile?: MerchantTrustProfile;
}

function toAbsoluteSchemaUrl(baseUrl: string, value?: string | null): string {
  if (!value) {
    return '';
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return '';
  }
}

function toAbsoluteSchemaImageUrl(
  baseUrl: string,
  ...values: Array<string | null | undefined>
): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const url = new URL(trimmed, baseUrl);
      const isHttpImage = url.protocol === 'http:' || url.protocol === 'https:';
      const absoluteImageUrl = url.toString();
      const isPlaceholder =
        url.pathname === PLACEHOLDER_IMAGE ||
        url.pathname.endsWith(PLACEHOLDER_IMAGE) ||
        isExternalPlaceholderImageUrl(absoluteImageUrl);

      if (isHttpImage && !isPlaceholder) {
        return normalizeOgabasseyCdnImageUrl(absoluteImageUrl);
      }
    } catch {
      // Ignore malformed image candidates and continue to the next fallback.
    }
  }

  return '';
}

/**
 * Generates CollectionPage schema for product listing pages (categories, collections).
 * @see https://schema.org/CollectionPage
 */
export function generateCollectionPageSchema(
  data: CollectionPageData
): CollectionPageJsonLdSchema {
  const safeProducts = data.products
    .flatMap((product) => {
      const imageCandidates = [product.imageLarge, product.image];
      const productImage = toAbsoluteSchemaImageUrl(
        data.url,
        ...imageCandidates
      );

      return productImage ? [{ product, productImage }] : [];
    })
    .slice(0, 20);
  const absolutePageUrl = toAbsoluteSchemaUrl(data.url, data.url);
  const currency = data.currency || 'NGN';
  const country = data.country || 'NG';
  const shippingDetails = buildOfferShippingDetails(
    country,
    currency,
    data.trustProfile
  );
  const hasMerchantReturnPolicy = buildMerchantReturnPolicy(
    country,
    data.trustProfile
  );

  const schema: CollectionPageJsonLdSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: escapeHtml(data.name),
    description: data.description ? escapeHtml(data.description) : undefined,
    ...(absolutePageUrl && { url: absolutePageUrl }),
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: safeProducts.length,
      itemListElement: safeProducts.map(({ product, productImage }, index) => {
        const productUrl = toAbsoluteSchemaUrl(
          data.url,
          getProductUrl(product)
        );

        return {
          '@type': 'ListItem',
          position: index + 1,
          item: {
            '@type': 'Product',
            name: escapeHtml(product.name),
            description: product.description
              ? escapeHtml(generateMetaDescription(product.description, 100))
              : undefined,
            image: [productImage],
            url: productUrl || undefined,
            brand: {
              '@type': 'Brand',
              name: escapeHtml(product.brand || data.merchantName),
            },
            ...(product.gtin && { gtin: escapeHtml(product.gtin) }),
            ...(product.mpn && { mpn: escapeHtml(product.mpn) }),
            offers: {
              '@type': 'Offer',
              price: product.price,
              priceCurrency: currency,
              availability: getSchemaAvailability(product),
              url: productUrl || undefined,
              shippingDetails,
              ...(hasMerchantReturnPolicy && { hasMerchantReturnPolicy }),
            },
          },
        };
      }),
    },
  };

  return schema;
}

/**
 * Generates OnlineStore schema for platform and merchant storefront entities
 * @see https://schema.org/OnlineStore
 */
export interface OrganizationData {
  name: string;
  url: string;
  country?: string;
  logo?: string;
  description?: string;
  email?: string;
  telephone?: string;
  socialMedia?: {
    facebook?: string;
    instagram?: string;
    twitter?: string;
    linkedin?: string;
    youtube?: string;
  };
  foundingDate?: string;
  trustProfile?: MerchantTrustProfile;
}

/**
 * Generates Organization schema for merchant branding and trust.
 * @see https://schema.org/Organization
 */
export function generateOrganizationSchema(
  data: OrganizationData & { trustProfile?: MerchantTrustProfile }
): JsonLdStructuredData {
  const schema: JsonLdStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    name: escapeHtml(data.name),
    url: escapeHtml(data.url),
  };

  if (data.logo) {
    const safeLogo = escapeHtml(data.logo);
    schema.logo = {
      '@type': 'ImageObject',
      url: safeLogo,
      width: 600,
      height: 60,
    };
    schema.image = safeLogo;
  }

  if (data.description) {
    schema.description = escapeHtml(data.description);
  }

  if (data.email) {
    schema.email = escapeHtml(data.email);
  }

  if (data.telephone) {
    schema.telephone = escapeHtml(data.telephone);
  }

  const foundingDate =
    data.foundingDate ?? data.trustProfile?.foundedYear?.toString();
  if (foundingDate) {
    schema.foundingDate = escapeHtml(foundingDate);
  }

  const sameAs = buildSameAsUrls(data, data.trustProfile);
  if (sameAs.length > 0) {
    schema.sameAs = sameAs;
  }

  const contactPoint = buildContactPoint(data, data.trustProfile);
  if (contactPoint) {
    schema.contactPoint = contactPoint;
  }

  const hasMerchantReturnPolicy = data.trustProfile?.returnPolicy
    ? buildMerchantReturnPolicy(data.country ?? 'NG', data.trustProfile)
    : undefined;

  if (hasMerchantReturnPolicy) {
    schema.hasMerchantReturnPolicy = hasMerchantReturnPolicy;
  }

  return schema;
}

/**
 * Generates WebSite schema with SearchAction for sitelinks search box
 * @see https://developers.google.com/search/docs/appearance/structured-data/sitelinks-searchbox
 */
export function generateWebSiteSchema(
  name: string,
  url: string,
  searchUrlTemplate?: string
): JsonLdStructuredData {
  const schema: JsonLdStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: escapeHtml(name),
    url: escapeHtml(url),
  };

  // Add search action for sitelinks search box
  if (searchUrlTemplate) {
    schema.potentialAction = {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: escapeHtml(searchUrlTemplate),
      },
      'query-input': 'required name=search_term_string',
    };
  }

  return schema;
}

/**
 * Generates AggregateRating schema for products with reviews
 * Returns the aggregateRating object to be merged into Product schema
 * @see https://schema.org/AggregateRating
 */
export interface ReviewStats {
  averageRating: number;
  reviewCount: number;
}

export interface AggregateRatingSchema {
  '@type': 'AggregateRating';
  ratingValue: number;
  reviewCount: number;
  bestRating?: number;
  worstRating?: number;
}

/**
 * Generates AggregateRating schema for products with reviews.
 * Returns the aggregateRating object to be merged into Product schema.
 * @see https://schema.org/AggregateRating
 */
export function generateAggregateRating(
  stats: ReviewStats
): AggregateRatingSchema | null {
  if (!stats.reviewCount || stats.reviewCount === 0) {
    return null;
  }

  return {
    '@type': 'AggregateRating',
    ratingValue: Math.round(stats.averageRating * 10) / 10, // Round to 1 decimal
    reviewCount: stats.reviewCount,
    bestRating: 5,
    worstRating: 1,
  };
}

/**
 * Constructs a clean canonical URL by removing noisy query parameters.
 * Best practice for 2025: Point to the "clean" version of the URL (without tracking/sorting).
 *
 * @param baseUrl - The absolute base URL (e.g., "https://store.com/products")
 * @param searchParams - The current search parameters object
 * @param allowedParams - List of parameters to KEEP (e.g., ['page', 'q']). All others are stripped.
 */
export function constructCanonicalUrl(
  baseUrl: string,
  searchParams:
    | URLSearchParams
    | { entries(): IterableIterator<[string, string]> }
    | Record<string, string | string[] | undefined>,
  allowedParams: string[] = ['page']
): string {
  // Normalize searchParams to URLSearchParams
  const params = new URLSearchParams();

  if (searchParams) {
    const entries =
      searchParams instanceof URLSearchParams
        ? searchParams.entries()
        : Object.entries(searchParams);

    for (const [key, value] of entries) {
      // Only keep allowed parameters
      if (allowedParams.includes(key)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            params.append(key, v);
          }
        } else if (value !== undefined) {
          params.append(key, value as string);
        }
      }
    }
  }

  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

/**
 * Blog Post Schema Data
 */
interface BlogPostSchemaData {
  title: string;
  description: string;
  url: string;
  image?: string;
  imageUrls?: string[];
  imageObjects?: Array<{
    '@type'?: 'ImageObject';
    url: string;
    width?: number;
    height?: number;
  }>;
  datePublished: string;
  dateModified?: string;
  author: {
    name: string;
    id?: string;
    url?: string;
    jobTitle?: string;
    description?: string;
    sameAs?: readonly unknown[];
    image?: string;
  };
  publisher: {
    id?: string;
    name: string;
    logo: string;
    url: string;
    sameAs?: readonly unknown[];
  };
  wordCount?: number;
  keywords?: string[];
  category?: string;
  readingTime?: number;
  blogId?: string;
}

function sanitizeSchemaEntityId(id: string): string {
  const trimmed = id.trim();
  const sanitized = sanitizeSchemaUrl(trimmed);
  if (!sanitized) {
    return '';
  }

  return trimmed.includes('/#')
    ? sanitized
    : sanitized.replace(/\/(#.+)$/, '$1');
}

function normalizeBlogAuthorSameAs(
  sameAs: readonly unknown[] | undefined
): string[] {
  if (!sameAs) {
    return [];
  }

  return [
    ...new Set(
      sameAs
        .filter((url): url is string => typeof url === 'string')
        .map((url) => sanitizeSchemaUrl(url.trim()))
        .filter((url) => url.length > 0)
    ),
  ];
}

/**
 * Generate Blog Post Schema (Article)
 */
export function generateBlogPostSchema(
  data: BlogPostSchemaData
): JsonLdStructuredData {
  // SECURITY FIX: Sanitize all inputs to prevent XSS (consistent with other schema functions)
  const authorSameAs = normalizeBlogAuthorSameAs(data.author.sameAs);
  const publisherSameAs = normalizeBlogAuthorSameAs(data.publisher.sameAs);
  const authorId = data.author.id
    ? sanitizeSchemaEntityId(data.author.id)
    : data.author.url
      ? sanitizeSchemaEntityId(
          `${data.author.url}#author-${generateStorefrontSlug(data.author.name)}`
        )
      : '';
  const publisherId = data.publisher.id
    ? sanitizeSchemaEntityId(data.publisher.id)
    : '';
  const blogId = data.blogId ? sanitizeSchemaEntityId(data.blogId) : '';
  const authorImage = data.author.image
    ? sanitizeSchemaUrl(data.author.image.trim())
    : '';
  const schema: JsonLdStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: escapeHtml(data.title),
    description: escapeHtml(data.description),
    url: escapeHtml(data.url),
    datePublished: data.datePublished,
    dateModified: data.dateModified || data.datePublished,
    author: {
      '@type': 'Person',
      ...(authorId && {
        '@id': escapeHtml(authorId),
      }),
      name: escapeHtml(data.author.name),
      ...(data.author.url && { url: escapeHtml(data.author.url) }),
      ...(data.author.jobTitle && {
        jobTitle: escapeHtml(data.author.jobTitle),
      }),
      ...(data.author.description && {
        description: escapeHtml(data.author.description),
      }),
      ...(authorSameAs.length > 0 && {
        sameAs: authorSameAs,
      }),
      ...(authorImage && { image: escapeHtml(authorImage) }),
    },
    publisher: {
      '@type': 'Organization',
      ...(publisherId && { '@id': escapeHtml(publisherId) }),
      name: escapeHtml(data.publisher.name),
      url: escapeHtml(data.publisher.url),
      logo: {
        '@type': 'ImageObject',
        url: escapeHtml(data.publisher.logo),
      },
      ...(publisherSameAs.length > 0 && {
        sameAs: publisherSameAs,
      }),
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': escapeHtml(data.url),
    },
    ...(blogId && {
      isPartOf: {
        '@type': 'Blog',
        '@id': escapeHtml(blogId),
      },
    }),
  };

  const imageUrls = Array.isArray(data.imageUrls)
    ? data.imageUrls.map((url) => url.trim()).filter((url) => url.length > 0)
    : [];
  const imageObjects: Record<string, unknown>[] = Array.isArray(
    data.imageObjects
  )
    ? data.imageObjects.flatMap((image) => {
        const url = sanitizeSchemaUrl(image.url.trim());
        if (!url) {
          return [];
        }

        const width = image.width;
        const height = image.height;

        return [
          {
            '@type': 'ImageObject',
            url,
            ...(typeof width === 'number' &&
              Number.isInteger(width) &&
              width > 0 && { width }),
            ...(typeof height === 'number' &&
              Number.isInteger(height) &&
              height > 0 && { height }),
          },
        ];
      })
    : [];

  if (imageObjects.length > 0) {
    schema.image = imageObjects;
  } else if (imageUrls.length > 0) {
    schema.image = imageUrls.map((url) => escapeHtml(url));
  } else if (data.image) {
    schema.image = {
      '@type': 'ImageObject',
      url: escapeHtml(data.image),
    };
  }

  if (data.wordCount) {
    schema.wordCount = data.wordCount;
  }

  if (data.keywords && data.keywords.length > 0) {
    // Sanitize each keyword
    schema.keywords = data.keywords.map((k) => escapeHtml(k)).join(', ');
  }

  if (data.category) {
    schema.articleSection = escapeHtml(data.category);
  }

  if (data.readingTime) {
    schema.timeRequired = `PT${data.readingTime}M`;
  }

  return schema;
}

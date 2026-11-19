import {
  type ProductWithSelectionAxesLike,
  resolveDefaultVariantSelection,
  resolveLowestPricedVariantSelection,
  resolveVariantSelectionParamResolution,
} from '@baci/shared/lib';
import { normalizeProductCondition } from '@/components/storefront/ogabassey/types';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import type { CachedProductLcpHint } from '@/lib/cached-data';
import { getCachedProductLcpHintPrimaryImage } from '@/lib/cached-product-lcp-hint-primary-image';
import { filterDefaultAdvertisedVariants } from '@/lib/default-advertised-variants';
import { getEffectiveStock } from '@/lib/product-stock';
import type { Product, ProductCondition, ProductVariant } from '@/lib/products';
import { stripVolatileProductPriceSentences } from '@/lib/storefront-product-description';
import { normalizeStorefrontProductVariants } from '@/lib/storefront-product-variants';
import {
  type CategoryProductRouteSearchParams,
  getVariantPrimaryImage,
  normalizeRouteProductVariants,
} from './critical-variant-selection';
import { getLcpRouteLegacyPrices } from './lcp-route-legacy-prices';
import { buildLcpRouteProductProjection } from './lcp-route-product-projection';
import { parseRouteProductNumber } from './parse-route-product-number';

export interface LcpRouteProduct {
  base_price?: number | null;
  baseImage?: string;
  brand: string;
  canonical_url?: string;
  categories?: { name?: string; slug?: string } | null;
  category?: string;
  category_slug?: string;
  color?: string;
  condition?: ProductCondition;
  compare_at_price?: number;
  default_variant_id?: string;
  description: string;
  gtin: string;
  has_variant_matrix?: boolean;
  has_variants?: boolean;
  id: string;
  image: string;
  imageHint: string;
  imageLarge: string;
  inventory_tracking_policy?: string | null;
  keywords?: string[];
  manage_stock: boolean;
  max_variant_price?: number;
  meta_description?: string;
  meta_title?: string;
  min_variant_price?: number;
  mpn: string;
  name: string;
  offers?: Array<{
    id: string;
    condition: ProductCondition;
    price: number;
    status?: string | null;
    stock_quantity: number;
  }>;
  price?: number | null;
  sale_price?: number | null;
  schema_markup?: Product['schema_markup'];
  slug?: string;
  status: Product['status'];
  stock: number;
  stock_quantity?: number | null;
  updated_at?: string | null;
  variant_attributes?: unknown;
  variants?: Product['variants'];
}

type CategorizedPdpLcpHint = CachedProductLcpHint & {
  status?: string | null;
};

function getInitialRouteVariant(
  cachedProduct: CachedProductLcpHint,
  variants: NonNullable<Product['variants']>,
  searchParams?: CategoryProductRouteSearchParams
) {
  const normalizedVariants = normalizeRouteProductVariants(variants);
  const resolutionProduct = {
    compare_at_price: parseRouteProductNumber(cachedProduct.compare_at_price),
    condition: normalizeProductCondition(cachedProduct.condition),
    manage_stock: cachedProduct.manage_stock,
    price: parseRouteProductNumber(cachedProduct.price) ?? 0,
    variants: normalizedVariants,
  };

  if (searchParams) {
    const selectionResolution = resolveVariantSelectionParamResolution(
      resolutionProduct as unknown as ProductWithSelectionAxesLike<ProductVariant>,
      searchParams
    );
    if (selectionResolution.type !== 'none') {
      const match = selectionResolution.matches[0];
      if (match) {
        return match;
      }
    }
  }

  const advertisedResolutionProduct = {
    ...resolutionProduct,
    variants: filterDefaultAdvertisedVariants(
      normalizedVariants,
      cachedProduct
    ),
  };

  return (
    resolveLowestPricedVariantSelection(advertisedResolutionProduct)?.variant ??
    resolveDefaultVariantSelection(advertisedResolutionProduct)?.variant ??
    null
  );
}

export function getCachedProductRoutePrimaryImage(
  cachedProduct: CachedProductLcpHint | null,
  variants?: NonNullable<Product['variants']>,
  searchParams?: CategoryProductRouteSearchParams
) {
  if (!cachedProduct) {
    return null;
  }

  const normalizedVariants =
    variants ??
    normalizeStorefrontProductVariants(cachedProduct.product_variants, {
      merchantId: cachedProduct.merchant_id || OGABASSEY_MERCHANT_ID,
      productId: cachedProduct.id,
      parentStock: getEffectiveStock(cachedProduct),
    });
  const initialVariant = getInitialRouteVariant(
    cachedProduct,
    normalizedVariants,
    searchParams
  );

  return (
    getVariantPrimaryImage(initialVariant) ||
    getCachedProductLcpHintPrimaryImage(cachedProduct)
  );
}

export function mapCachedProductLcpHintToRouteProduct(
  cachedProduct: CategorizedPdpLcpHint
): LcpRouteProduct {
  const rawCanonicalCategory = cachedProduct.categories;
  const canonicalCategory = Array.isArray(rawCanonicalCategory)
    ? rawCanonicalCategory[0]
    : rawCanonicalCategory;
  const rawFallbackCategory = cachedProduct.product_categories?.[0]?.categories;
  const fallbackCategory = Array.isArray(rawFallbackCategory)
    ? rawFallbackCategory[0]
    : rawFallbackCategory;
  const primaryCategory = canonicalCategory ?? fallbackCategory;
  const legacyPrices = getLcpRouteLegacyPrices(cachedProduct);
  const manageStock = cachedProduct.manage_stock ?? true;
  const effectiveStock = getEffectiveStock(cachedProduct);
  const canUseDenormalizedVariantPrices = manageStock === false;
  const variants = normalizeStorefrontProductVariants(
    cachedProduct.product_variants,
    {
      merchantId: cachedProduct.merchant_id || OGABASSEY_MERCHANT_ID,
      productId: cachedProduct.id,
      parentStock: effectiveStock,
    }
  );
  const primaryImage =
    getCachedProductRoutePrimaryImage(cachedProduct, variants) || '';
  const baseImage = getCachedProductLcpHintPrimaryImage(cachedProduct) || '';
  const {
    condition: productCondition,
    hasVariantMatrix,
    offers,
  } = buildLcpRouteProductProjection({
    condition: cachedProduct.condition,
    product_offers: cachedProduct.product_offers,
    product_variants: cachedProduct.product_variants,
  });

  return {
    base_price: legacyPrices.basePrice,
    baseImage,
    brand: cachedProduct.brand ?? '',
    canonical_url: cachedProduct.canonical_url ?? undefined,
    categories: primaryCategory,
    category: primaryCategory?.name ?? cachedProduct.category ?? undefined,
    category_slug: primaryCategory?.slug,
    color: cachedProduct.color ?? undefined,
    condition: productCondition,
    compare_at_price: legacyPrices.compareAtPrice ?? undefined,
    default_variant_id: cachedProduct.default_variant_id ?? undefined,
    description: cachedProduct.meta_description ?? '',
    gtin: '',
    has_variants: Boolean(cachedProduct.has_variants) || variants.length > 0,
    has_variant_matrix: hasVariantMatrix,
    id: cachedProduct.id,
    keywords: cachedProduct.keywords ?? undefined,
    image: primaryImage,
    imageHint: cachedProduct.name,
    imageLarge: primaryImage,
    inventory_tracking_policy: cachedProduct.inventory_tracking_policy ?? null,
    manage_stock: manageStock,
    max_variant_price: canUseDenormalizedVariantPrices
      ? (parseRouteProductNumber(cachedProduct.max_variant_price) ?? undefined)
      : undefined,
    meta_description: cachedProduct.meta_description ?? undefined,
    meta_title: cachedProduct.meta_title ?? undefined,
    min_variant_price: canUseDenormalizedVariantPrices
      ? (parseRouteProductNumber(cachedProduct.min_variant_price) ?? undefined)
      : undefined,
    mpn: '',
    name: cachedProduct.name,
    offers,
    price: legacyPrices.price,
    sale_price: legacyPrices.salePrice,
    schema_markup: cachedProduct.schema_markup as Product['schema_markup'],
    slug: cachedProduct.slug ?? cachedProduct.id,
    status: cachedProduct.status === 'active' ? 'active' : 'archived',
    stock: effectiveStock,
    stock_quantity: effectiveStock,
    updated_at: cachedProduct.updated_at,
    variant_attributes: cachedProduct.variant_attributes,
    variants,
  };
}

export function buildCriticalCommerceRouteProduct(
  product: LcpRouteProduct
): Product {
  return {
    ...product,
    compare_at_price: product.compare_at_price ?? undefined,
    description: stripVolatileProductPriceSentences(product.description),
    max_variant_price: product.max_variant_price ?? undefined,
    min_variant_price: product.min_variant_price ?? undefined,
    price: product.price ?? 0,
  };
}

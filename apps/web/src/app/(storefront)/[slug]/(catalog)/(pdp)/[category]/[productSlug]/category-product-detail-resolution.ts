import { normalizeProductCondition } from '@/components/storefront/ogabassey/types';
import type { VariantAttributeSource } from '@/components/storefront/ogabassey/variant-attributes';
import { normalizeVariantAttributes } from '@/components/storefront/ogabassey/variant-attributes';
import type {
  CachedLegacyProductRedirectTarget,
  CachedMerchant,
} from '@/lib/cached-data';
import {
  getCachedLegacyProductRedirectTarget,
  getCachedProductWithDetails,
} from '@/lib/cached-data';
import { normalizeStorefrontCategorySlug } from '@/lib/normalize-storefront-category-slug';
import { getEffectiveStock } from '@/lib/product-stock';
import type { Product } from '@/lib/products';
import { generateSlug } from '@/lib/seo-utils';
import { normalizeStorefrontProductVariants } from '@/lib/storefront-product-variants';

export type CategoryProductResult =
  | {
      product: Product;
      categoryMismatch: boolean;
      merchant: CachedMerchant;
      needsValuesRedirect: boolean;
    }
  | {
      merchant: CachedMerchant;
      legacyRedirectTarget: CachedLegacyProductRedirectTarget;
    }
  | null;

export function hasCategoryMismatch(
  productCategorySlug: string | null | undefined,
  urlCategorySlug: string
) {
  const normalizedProductCategorySlug =
    normalizeStorefrontCategorySlug(productCategorySlug);
  const normalizedUrlCategorySlug =
    normalizeStorefrontCategorySlug(urlCategorySlug);

  return Boolean(
    normalizedProductCategorySlug &&
      normalizedProductCategorySlug !== normalizedUrlCategorySlug
  );
}

function isUuidProductRouteValue(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function shouldRedirectResolvedProductSlugValue(
  productSlug: string,
  resolvedSlug: string | null | undefined
) {
  return (
    !isUuidProductRouteValue(productSlug) &&
    Boolean(resolvedSlug) &&
    resolvedSlug !== productSlug &&
    resolvedSlug?.toLowerCase() === productSlug.toLowerCase()
  );
}

export async function resolveCategoryProductForMerchant(
  merchant: CachedMerchant,
  categorySlug: string,
  productSlug: string
): Promise<CategoryProductResult> {
  // The bounded PDP snapshot normalizes identifiers in PostgreSQL, so a
  // mixed-case request resolves here once and redirects to the stored slug.
  const product = await getCachedProductWithDetails(merchant.id, productSlug);

  if (!product) {
    const legacyRedirectTarget = await getCachedLegacyProductRedirectTarget(
      merchant.id,
      productSlug
    );

    return legacyRedirectTarget ? { merchant, legacyRedirectTarget } : null;
  }

  const needsValuesRedirect = shouldRedirectResolvedProductSlugValue(
    productSlug,
    product.slug
  );
  const productWithCat = product as unknown as {
    categories?: {
      id: string;
      name: string;
      slug: string;
      parent_id?: string;
    } | null;
  };
  const joinedCategory = productWithCat.categories;
  const dbCategorySlug = joinedCategory?.slug;
  const dbCategoryName = joinedCategory?.name || product.category;

  const rawImages = Array.isArray(product.images)
    ? (product.images as Array<string | { url: string; alt?: string }>)
    : [];
  const normalizedImages = rawImages.map((image, index) =>
    typeof image === 'string'
      ? { url: image, alt: product.name, order: index }
      : {
          url: image.url,
          alt: image.alt || product.name,
          order: index,
        }
  );
  const primaryImage = normalizedImages[0]?.url || '/placeholder.png';
  const rawVariantAttributes = (product as { variant_attributes?: unknown })
    .variant_attributes as VariantAttributeSource;
  const normalizedVariantAttributes =
    normalizeVariantAttributes(rawVariantAttributes);
  const manageStock = product.manage_stock ?? true;

  const productWithCategorySlug: Product = {
    ...product,
    product_key_specs:
      product.product_key_specs as unknown as Product['product_key_specs'],
    description: product.description || '',
    price:
      typeof product.price === 'string'
        ? Number.parseFloat(product.price) || 0
        : product.price,
    compare_at_price:
      typeof product.compare_at_price === 'string'
        ? Number.parseFloat(product.compare_at_price) || undefined
        : product.compare_at_price,
    manage_stock: manageStock,
    stock: getEffectiveStock(product),
    image: primaryImage,
    imageLarge: primaryImage,
    imageHint: product.imageHint || product.name,
    images: normalizedImages,
    variant_attributes: normalizedVariantAttributes,
    fulfillmentFields: product.fulfillmentFields || [],
    category: dbCategoryName || product.category,
    category_slug: dbCategorySlug,
    offers: product.product_offers?.filter((offer) => {
      const offerCondition = normalizeProductCondition(offer.condition);
      const productCondition = normalizeProductCondition(product.condition);
      return (
        offerCondition !== undefined &&
        offerCondition !== productCondition &&
        offer.status === 'active'
      );
    }),
    variants: normalizeStorefrontProductVariants(product.product_variants, {
      merchantId: product.merchant_id || merchant.id,
      productId: product.id,
    }),
    has_variant_matrix:
      Array.isArray(product.product_variants) &&
      product.product_variants.length > 0,
  } as unknown as Product;

  const productCategorySlug =
    dbCategorySlug ||
    (product.category ? generateSlug(product.category) : null);

  return {
    product: productWithCategorySlug,
    categoryMismatch: hasCategoryMismatch(productCategorySlug, categorySlug),
    merchant,
    needsValuesRedirect,
  };
}

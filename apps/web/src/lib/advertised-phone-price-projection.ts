import 'server-only';
import { normalizeCanonicalProductCondition } from '@baci/shared/lib/product-condition';
import { getEffectiveStock } from './product-stock';
import { projectPublicVariantSelection } from './project-public-variant-selection';
import { assertPublicListingProductRows } from './read-public-listing-product-rows';
import { resolvePublicProductOption } from './resolve-public-product-option';
import { normalizeStorefrontProductVariants } from './storefront-product-variants';
import type { StorefrontVariantProductContext } from './storefront-variant-disclosure';
import {
  filterDefaultAdvertisedVariants,
  isCellularPhoneProduct,
  resolveDefaultAdvertisedVariantSelection,
} from './storefront-variant-disclosure';

export interface AdvertisedPhonePriceFacts {
  advertised_price?: number;
  advertised_condition?: string | null;
  advertised_compare_at_price?: number | null;
  advertised_image?: string;
  advertised_min_variant_price?: number;
  advertised_max_variant_price?: number;
}

export interface AdvertisedPhoneProduct
  extends StorefrontVariantProductContext,
    AdvertisedPhonePriceFacts {
  id: string;
  price?: number | string | null;
  compare_at_price?: number | null;
  condition?: string | null;
  has_variants?: boolean | null;
  variant_model?: string | null;
  manage_stock?: boolean | null;
  stock?: number | string | null;
  stock_quantity?: number | string | null;
}
export type PublicAdvertisedVariant = NonNullable<
  Parameters<typeof normalizeStorefrontProductVariants>[0]
>[number];
export type PublicAdvertisedVariantLoader = (
  merchantId: string,
  productIds: string[]
) => Promise<Record<string, PublicAdvertisedVariant[]>>;

/** Prefer only actual selected-variant imagery; never infer it from a filename. */
export function resolveAdvertisedVariantImage(
  variant: PublicAdvertisedVariant
): string | undefined {
  if (typeof variant.primary_image === 'string' && variant.primary_image.trim())
    return variant.primary_image;
  return Array.isArray(variant.images)
    ? variant.images.find(
        (image): image is string =>
          typeof image === 'string' && image.trim().length > 0
      )
    : undefined;
}

export interface AdvertisedPhoneConstraints {
  condition?: string;
  minPrice?: number;
  maxPrice?: number;
}

/** Listing-only scalar facts; product.price always remains the checkout base. */
export async function projectAdvertisedPhonePrices<
  T extends AdvertisedPhoneProduct,
>(
  merchantId: string,
  products: T[],
  loadVariants: PublicAdvertisedVariantLoader,
  constraints: AdvertisedPhoneConstraints = {}
): Promise<Array<T & AdvertisedPhonePriceFacts>> {
  assertPublicListingProductRows(products);
  const families = products.filter(
    (product) =>
      isCellularPhoneProduct(product) &&
      (product.has_variants === true || product.variant_model === 'sku_matrix')
  );
  if (families.length === 0) return products;
  const familyIds = [...new Set(families.map((product) => product.id))];
  const variantsByProduct = await loadVariants(merchantId, familyIds);
  const familyIdSet = new Set(familyIds);
  return products.flatMap<T & AdvertisedPhonePriceFacts>((product) => {
    if (!familyIdSet.has(product.id)) return [product];
    const value = Number(product.price);
    const parentStock = getEffectiveStock(product);
    const parent = {
      ...product,
      price: Number.isFinite(value) ? value : 0,
      stock: parentStock,
      stock_quantity: parentStock,
    };
    const variants = normalizeStorefrontProductVariants(
      (variantsByProduct[product.id] ?? []).filter(
        (variant) => variant.product_id === product.id
      ),
      {
        merchantId,
        productId: product.id,
        parentStock: getEffectiveStock(parent),
      }
    );
    const eligible = filterDefaultAdvertisedVariants(
      projectPublicVariantSelection(parent, variants),
      product
    ).filter((variant) => {
      const option = resolvePublicProductOption(parent, { variant });
      return (
        variant.is_purchasable &&
        typeof option.price === 'number' &&
        Number.isFinite(option.price) &&
        option.price > 0
      );
    });
    const selected = resolveDefaultAdvertisedVariantSelection(
      { ...parent, variants: eligible },
      product
    );
    if (!selected) return [];
    const requestedCondition = normalizeCanonicalProductCondition(
      constraints.condition
    );
    if (
      (constraints.minPrice !== undefined &&
        selected.price < constraints.minPrice) ||
      (constraints.maxPrice !== undefined &&
        selected.price > constraints.maxPrice) ||
      (['new', 'used', 'open_box', 'refurbished'].includes(
        requestedCondition
      ) &&
        selected.condition !== requestedCondition)
    )
      return [];

    const prices = eligible
      .map((variant) => resolvePublicProductOption(parent, { variant }).price)
      .filter((price): price is number => typeof price === 'number');
    return [
      {
        ...product,
        has_variants: true,
        advertised_price: selected.price,
        advertised_condition: selected.condition ?? product.condition,
        advertised_compare_at_price: null,
        ...(resolveAdvertisedVariantImage(selected.variant)
          ? {
              advertised_image: resolveAdvertisedVariantImage(selected.variant),
            }
          : {}),
        advertised_min_variant_price: Math.min(...prices),
        advertised_max_variant_price: Math.max(...prices),
      },
    ];
  });
}

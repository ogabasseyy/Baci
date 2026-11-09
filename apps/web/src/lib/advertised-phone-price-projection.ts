import 'server-only';
import { normalizeCanonicalProductCondition } from '@baci/shared/lib/product-condition';
import { assertPublicListingProductRows } from './assert-public-listing-product-rows';
import {
  isCellularPhoneProduct,
  type StorefrontVariantProductContext,
} from './cellular-phone-classification';
import { filterDefaultAdvertisedVariants } from './default-advertised-variants';
import { getEffectiveStock } from './product-stock';
import { projectPublicVariantSelection } from './project-public-variant-selection';
import { resolveAdvertisedVariantImage } from './resolve-advertised-variant-image';
import { resolveDefaultAdvertisedVariantSelection } from './resolve-default-advertised-variant-selection';
import { resolvePublicProductOption } from './resolve-public-product-option';
import { normalizeStorefrontProductVariants } from './storefront-product-variants';

export const MAX_PHONE_FAMILY_BATCH_SIZE = 200;

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
  availability?: string | null;
}
export type PublicAdvertisedVariant = NonNullable<
  Parameters<typeof normalizeStorefrontProductVariants>[0]
>[number];
export type PublicAdvertisedVariantLoader = (
  merchantId: string,
  productIds: string[]
) => Promise<Record<string, PublicAdvertisedVariant[]>>;

export interface AdvertisedPhoneConstraints {
  condition?: string;
  minPrice?: number;
  maxPrice?: number;
}

function getEligibleAdvertisedVariants(
  product: AdvertisedPhoneProduct,
  rawVariants: PublicAdvertisedVariant[],
  merchantId?: string
) {
  const value = Number(product.price);
  const parentStock = getEffectiveStock(product);
  const parent = {
    ...product,
    price: Number.isFinite(value) ? value : 0,
    stock: parentStock,
    stock_quantity: parentStock,
  };
  const variants = normalizeStorefrontProductVariants(
    rawVariants.filter((variant) => variant.product_id === product.id),
    {
      merchantId: merchantId ?? '',
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
  return { parent, eligible };
}

type EligibleAdvertisedVariant = ReturnType<
  typeof getEligibleAdvertisedVariants
>['eligible'][number];

function filterConstrainedEligibleVariants(
  parent: Record<string, unknown>,
  product: AdvertisedPhoneProduct,
  eligible: EligibleAdvertisedVariant[],
  constraints: AdvertisedPhoneConstraints = {}
) {
  const requestedCondition = normalizeCanonicalProductCondition(
    constraints.condition
  );
  return eligible.filter((variant) => {
    const option = resolvePublicProductOption(parent, { variant });
    if (typeof option.price !== 'number') return false;
    if (
      constraints.minPrice !== undefined &&
      option.price < constraints.minPrice
    ) {
      return false;
    }
    if (
      constraints.maxPrice !== undefined &&
      option.price > constraints.maxPrice
    ) {
      return false;
    }
    if (
      requestedCondition &&
      ['new', 'used', 'open_box', 'refurbished'].includes(requestedCondition)
    ) {
      const optionCondition = normalizeCanonicalProductCondition(
        option.condition ?? variant.condition ?? product.condition
      );
      if (optionCondition !== requestedCondition) {
        return false;
      }
    }
    return true;
  });
}

export function selectAdvertisedPhoneVariant(
  product: AdvertisedPhoneProduct,
  rawVariants: PublicAdvertisedVariant[],
  constraints: AdvertisedPhoneConstraints = {},
  merchantId?: string
) {
  const { parent, eligible } = getEligibleAdvertisedVariants(
    product,
    rawVariants,
    merchantId
  );
  const constrainedEligible = filterConstrainedEligibleVariants(
    parent,
    product,
    eligible,
    constraints
  );
  return resolveDefaultAdvertisedVariantSelection(
    { ...parent, variants: constrainedEligible },
    product
  );
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

  const chunkedIds: string[][] = [];
  for (let i = 0; i < familyIds.length; i += MAX_PHONE_FAMILY_BATCH_SIZE) {
    chunkedIds.push(familyIds.slice(i, i + MAX_PHONE_FAMILY_BATCH_SIZE));
  }
  const chunkedVariants = await Promise.all(
    chunkedIds.map((batch) => loadVariants(merchantId, batch))
  );
  const variantsByProduct: Record<string, PublicAdvertisedVariant[]> = {};
  for (const chunk of chunkedVariants) {
    if (!chunk) continue;
    for (const [productId, variants] of Object.entries(chunk)) {
      if (Array.isArray(variants)) {
        variantsByProduct[productId] = [
          ...(variantsByProduct[productId] ?? []),
          ...variants,
        ];
      }
    }
  }

  const familyIdSet = new Set(familyIds);
  return products.flatMap<T & AdvertisedPhonePriceFacts>((product) => {
    if (!familyIdSet.has(product.id)) return [product];
    const rawVariants = (variantsByProduct[product.id] ?? []).filter(
      (variant) => variant.product_id === product.id
    );
    const { parent, eligible } = getEligibleAdvertisedVariants(
      product,
      rawVariants,
      merchantId
    );
    const constrainedEligible = filterConstrainedEligibleVariants(
      parent,
      product,
      eligible,
      constraints
    );
    const selected = resolveDefaultAdvertisedVariantSelection(
      { ...parent, variants: constrainedEligible },
      product
    );
    if (!selected) return [];
    const selectedOption = resolvePublicProductOption(parent, {
      variant: selected.variant,
    });

    const prices = eligible
      .map((variant) => resolvePublicProductOption(parent, { variant }).price)
      .filter((price): price is number => typeof price === 'number');
    return [
      {
        ...product,
        has_variants: true,
        advertised_price: selected.price,
        advertised_condition:
          selectedOption.condition ?? selected.condition ?? product.condition,
        advertised_compare_at_price: null,
        ...(resolveAdvertisedVariantImage(selected.variant)
          ? {
              advertised_image: resolveAdvertisedVariantImage(selected.variant),
            }
          : {}),
        advertised_min_variant_price: Math.min(...prices),
        advertised_max_variant_price: Math.max(...prices),
        ...(product.manage_stock === true && selected.variant.is_purchasable
          ? { availability: 'InStock' }
          : {}),
      },
    ];
  });
}

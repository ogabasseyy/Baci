import { isProductVariantPurchasable } from '@baci/shared/lib/is-product-variant-purchasable';
import { isPurchasableProduct } from './product-card-is-purchasable-product';
import { isRecord } from './product-card-is-record';
import { toCardName } from './product-card-name';
import { normalizedCondition } from './product-card-normalized-condition';
import { numericStock } from './product-card-numeric-stock';
import { parentEffectiveStock } from './product-card-parent-effective-stock';
import { projectAttributes } from './product-card-project-attributes';
import { toImage } from './product-card-to-image';
import { toPrice } from './product-card-to-price';
import { UUID_PATTERN } from './product-card-uuid-pattern';

export type ChatwootProductCard = {
  slug: string;
  name: string;
  price: number;
  currency: string;
  availability: 'in_stock' | 'out_of_stock';
  image?: string;
  condition?: 'new' | 'used' | 'open_box';
  variants: Array<{
    id: string;
    attributes: Record<string, string>;
    price: number;
    image?: string;
    availability: 'in_stock' | 'out_of_stock';
    condition?: 'new' | 'used' | 'open_box';
  }>;
};

export type ChatwootProductCardProjection =
  | { ok: true; product: ChatwootProductCard }
  | { ok: false; code: 'unsupported_condition_offers' | 'product_unavailable' };

export function projectChatwootProductCard(input: {
  currency: string;
  product: unknown;
  merchantId: string;
  requestedSlug: string;
}): ChatwootProductCardProjection {
  const product = input.product;
  if (
    !/^[A-Z]{3}$/.test(input.currency) ||
    !isRecord(product) ||
    product.merchant_id !== input.merchantId ||
    typeof product.id !== 'string' ||
    !UUID_PATTERN.test(product.id) ||
    product.status !== 'active' ||
    typeof product.slug !== 'string' ||
    product.slug.toLowerCase() !== input.requestedSlug.toLowerCase() ||
    toCardName(product.name) === null ||
    typeof product.has_variants !== 'boolean' ||
    product.has_condition_offers !== false
  ) {
    return {
      ok: false,
      code:
        isRecord(product) && product.has_condition_offers === true
          ? 'unsupported_condition_offers'
          : 'product_unavailable',
    };
  }
  // Canonical variant-bearing predicate: a stale false `has_variants` flag
  // on an sku_matrix product still means the product has variants.
  const hasVariants =
    product.has_variants === true || product.variant_model === 'sku_matrix';
  const basePrice = toPrice(product.price);
  if (basePrice === null) return { ok: false, code: 'product_unavailable' };

  const rawVariants = product.product_variants;
  if (
    product.variants_truncated === true ||
    (hasVariants &&
      (!Array.isArray(rawVariants) ||
        rawVariants.length === 0 ||
        rawVariants.length > 128)) ||
    (!hasVariants && Array.isArray(rawVariants) && rawVariants.length > 0)
  ) {
    return { ok: false, code: 'product_unavailable' };
  }

  const variants: ChatwootProductCard['variants'] = [];
  if (hasVariants) {
    for (const candidate of rawVariants as unknown[]) {
      if (
        !isRecord(candidate) ||
        typeof candidate.id !== 'string' ||
        !UUID_PATTERN.test(candidate.id) ||
        candidate.product_id !== product.id
      ) {
        return { ok: false, code: 'product_unavailable' };
      }
      const attributes = projectAttributes(candidate.attributes);
      const variantPrice = toPrice(candidate.price_override ?? basePrice);
      if (attributes === null || variantPrice === null) {
        return { ok: false, code: 'product_unavailable' };
      }
      const available = isProductVariantPurchasable(
        typeof product.manage_stock === 'boolean' ? product.manage_stock : true,
        {
          in_stock:
            typeof candidate.in_stock === 'boolean'
              ? candidate.in_stock
              : undefined,
          is_purchasable:
            typeof candidate.is_purchasable === 'boolean'
              ? candidate.is_purchasable
              : undefined,
          available_units:
            typeof candidate.available_units === 'number'
              ? candidate.available_units
              : undefined,
          effective_policy:
            typeof candidate.effective_policy === 'string'
              ? candidate.effective_policy
              : undefined,
          inventory_tracking_policy:
            typeof candidate.inventory_tracking_policy === 'string'
              ? candidate.inventory_tracking_policy
              : undefined,
          stock_quantity:
            numericStock(candidate.stock_quantity) ??
            (typeof candidate.in_stock === 'boolean'
              ? undefined
              : parentEffectiveStock(product)),
        }
      );
      const rawVariantCondition =
        typeof candidate.condition === 'string'
          ? candidate.condition.trim()
          : candidate.condition;
      const normalizedVariantCondition =
        normalizedCondition(rawVariantCondition);
      if (
        rawVariantCondition !== null &&
        rawVariantCondition !== undefined &&
        rawVariantCondition !== '' &&
        normalizedVariantCondition === undefined
      ) {
        return { ok: false, code: 'product_unavailable' };
      }
      const variantCondition =
        normalizedVariantCondition ?? normalizedCondition(product.condition);
      const variantImage =
        toImage(candidate.primary_image) ??
        (Array.isArray(candidate.images)
          ? candidate.images.map(toImage).find(Boolean)
          : undefined);
      variants.push({
        id: candidate.id as string,
        ...(variantImage ? { image: variantImage } : {}),
        attributes,
        price: variantPrice,
        availability: available ? 'in_stock' : 'out_of_stock',
        ...(variantCondition ? { condition: variantCondition } : {}),
      });
    }
    if (variants.length === 0) {
      return { ok: false, code: 'product_unavailable' };
    }
    const distinctSelections = new Set(
      variants.map((variant) =>
        JSON.stringify({
          attributes: Object.entries(variant.attributes).sort(
            ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)
          ),
          condition: variant.condition,
        })
      )
    );
    if (distinctSelections.size !== variants.length) {
      return { ok: false, code: 'product_unavailable' };
    }
  }

  const purchasableVariants = variants.filter(
    (variant) => variant.availability === 'in_stock'
  );
  const available = hasVariants
    ? purchasableVariants.length > 0
    : isPurchasableProduct(product);
  // The widget hides card-level price for out-of-stock products. Keep this
  // required numeric field catalog-derived when no variant can be purchased.
  const priceVariants =
    purchasableVariants.length > 0 ? purchasableVariants : variants;
  const cardPrice = hasVariants
    ? Math.min(...priceVariants.map((variant) => variant.price))
    : basePrice;
  const images = Array.isArray(product.images) ? product.images : [];
  const image = images.map(toImage).find(Boolean);
  const condition = normalizedCondition(product.condition);
  const variantConditions = new Set(
    variants.map((variant) => variant.condition)
  );
  const cardCondition =
    hasVariants && variantConditions.size > 1
      ? undefined
      : (variants[0]?.condition ?? condition);

  return {
    ok: true,
    product: {
      slug: product.slug,
      name: toCardName(product.name) as string,
      price: cardPrice,
      currency: input.currency,
      availability: available ? 'in_stock' : 'out_of_stock',
      ...(image ? { image } : {}),
      ...(cardCondition ? { condition: cardCondition } : {}),
      variants,
    },
  };
}

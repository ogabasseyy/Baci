import type { RawDbProduct } from '@/lib/normalize-product';
import { normalizeProduct } from '@/lib/normalize-product';
import { getEffectiveStock } from '@/lib/product-stock';
import { resolveVariantInventory } from '@/lib/resolve-variant-inventory';
import {
  buildStorefrontVariantTitle,
  filterDefaultAdvertisedVariants,
} from '@/lib/storefront-variant-disclosure';
import { extractComparableKeySpecs } from './comparable-key-specs';

interface BudgetVariant {
  id: string;
  attributes?: Record<string, unknown> | null;
  condition?: string | null;
  price_override?: number | string | null;
  effective_policy?: string | null;
  inventory_tracking_policy?: string | null;
  stock_quantity?: number | null;
  available_units?: number | null;
}

function isVariant(value: unknown): value is BudgetVariant {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      typeof value.id === 'string'
  );
}

function isFeaturePhone(product: RawDbProduct): boolean {
  const specs = extractComparableKeySpecs(product.product_key_specs);
  const tags = specs?.recommended_for;
  if (Array.isArray(tags) && tags.some((value) => value === 'feature_phone'))
    return true;
  const facts = [product.product_type, specs?.product_type, specs?.type];
  const groups = Array.isArray(product.specifications)
    ? product.specifications
    : [];
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    const items =
      'specs' in group && Array.isArray(group.specs) ? group.specs : [group];
    for (const item of items) {
      if (
        item &&
        typeof item === 'object' &&
        'key' in item &&
        'value' in item &&
        /^(type|product type)$/i.test(String(item.key))
      )
        facts.push(item.value);
    }
  }
  return facts.some(
    (value) => typeof value === 'string' && /^feature[ _-]phone$/i.test(value)
  );
}

/** One precisely priced offer per model, never a restricted or depleted fallback. */
export function selectPriceBandOffer(
  raw: RawDbProduct,
  categorySlug: string,
  ceiling: number,
  floor?: number
) {
  if (categorySlug === 'smartphones' && isFeaturePhone(raw)) return null;
  const product = normalizeProduct(raw, {
    preferredCategorySlug: categorySlug,
  });
  const variants = Array.isArray(raw.product_variants)
    ? raw.product_variants.filter(isVariant)
    : [];
  const parent = {
    manage_stock: raw.manage_stock,
    stock: getEffectiveStock(raw),
    stock_quantity:
      typeof raw.stock_quantity === 'number' ? raw.stock_quantity : undefined,
  };
  const eligible = filterDefaultAdvertisedVariants(variants, {
    name: raw.name,
    category: raw.category,
    category_slug: categorySlug,
  })
    .filter((variant) => resolveVariantInventory(parent, variant).purchasable)
    .map((variant) => ({
      variant,
      price: Number(variant.price_override ?? raw.price),
    }))
    .filter(({ price }) => Number.isFinite(price) && price > 0)
    .sort(
      (left, right) =>
        left.price - right.price ||
        left.variant.id.localeCompare(right.variant.id)
    );
  const selected = eligible[0];
  if (
    (raw.has_variants === true ||
      raw.variant_model === 'sku_matrix' ||
      variants.length > 0) &&
    !selected
  )
    return null;
  // A condition-offer parent cannot promise an exact condition at its aggregate price.
  if (!selected && raw.has_condition_offers) return null;
  const baseInventory = resolveVariantInventory(parent, {});
  if (!selected && !baseInventory.purchasable) return null;
  const price = selected?.price ?? product.price;
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    price >= ceiling ||
    (floor !== undefined && price <= floor)
  )
    return null;
  const inventory = selected
    ? resolveVariantInventory(parent, selected.variant)
    : null;
  const policy =
    selected?.variant.effective_policy ??
    selected?.variant.inventory_tracking_policy;
  const tracked = inventory
    ? inventory.manageStock && policy !== 'serialized_then_unlimited'
    : baseInventory.manageStock;
  const condition = selected?.variant.condition ?? product.condition;
  const name = selected
    ? buildStorefrontVariantTitle(raw.name, { ...selected.variant, condition })
    : `${raw.name} - ${condition}`;
  const availabilityLabel = tracked
    ? 'In stock'
    : 'Available to order — confirm fulfillment';
  return {
    ...product,
    name,
    price,
    condition,
    has_condition_offers: false,
    availability: 'InStock' as const,
    availabilityLabel,
    variantId: selected?.variant.id,
    // Parent descriptions/specs can describe a more expensive configuration.
    description: `${name}. ${availabilityLabel}. Confirm accessories, warranty and delivery before payment.`,
    product_key_specs: selected ? null : product.product_key_specs,
  };
}

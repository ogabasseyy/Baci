import type {
  Product as CartProduct,
  ProductCondition,
  ProductVariant,
} from '@/lib/products';

const VALID_CART_CONDITIONS = new Set<ProductCondition>([
  'new',
  'used',
  'open_box',
  'refurbished',
]);

const TRACKED_VARIANT_POLICIES = new Set([
  'serialized_strict',
  'serialized_then_unlimited',
  'standard',
]);

export type CriticalCartVariant = Omit<
  ProductVariant,
  'cost_price' | 'inventory_items' | 'merchant_id' | 'product_id' | 'sku'
>;

export type CriticalCartVariantInput = CriticalCartVariant | ProductVariant;

export type CriticalCartProduct = Omit<CartProduct, 'variants'> & {
  variants?: CriticalCartVariant[];
};

export type CriticalCartProductInput = CriticalCartProduct | CartProduct;

type CriticalCartSource = Pick<
  CartProduct,
  | 'available_conditions'
  | 'brand'
  | 'category'
  | 'category_slug'
  | 'compare_at_price'
  | 'condition'
  | 'default_variant_id'
  | 'description'
  | 'effective_policy'
  | 'gtin'
  | 'has_variants'
  | 'id'
  | 'image'
  | 'imageHint'
  | 'imageLarge'
  | 'inventory_tracking_policy'
  | 'manage_stock'
  | 'mpn'
  | 'name'
  | 'offers'
  | 'price'
  | 'slug'
  | 'status'
  | 'stock'
  | 'stock_quantity'
  | 'variants'
>;

function normalizeCartCondition(
  condition: ProductCondition | string | null | undefined
): ProductCondition | undefined {
  if (!condition) return undefined;
  return VALID_CART_CONDITIONS.has(condition as ProductCondition)
    ? (condition as ProductCondition)
    : undefined;
}

function trimCriticalVariantAttributes(
  attributes: Record<string, string> | null | undefined
): Record<string, string> {
  const trimmed: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes || {})) {
    if (typeof value !== 'string') continue;
    const normalizedValue = value.trim();
    if (!normalizedValue) continue;
    trimmed[key] = normalizedValue;
  }
  return trimmed;
}

function trimCriticalCartVariant(variant: ProductVariant): CriticalCartVariant {
  const primaryImage = variant.primary_image || variant.images?.[0] || undefined;
  const effectivePolicy =
    variant.effective_policy ?? variant.inventory_tracking_policy;
  const keepTrackedPolicy =
    typeof effectivePolicy === 'string' &&
    TRACKED_VARIANT_POLICIES.has(effectivePolicy);

  return {
    id: variant.id,
    attributes: trimCriticalVariantAttributes(variant.attributes),
    stock_quantity: variant.stock_quantity,
    ...(variant.condition ? { condition: variant.condition } : {}),
    ...(typeof variant.price_override === 'number' &&
    Number.isFinite(variant.price_override)
      ? { price_override: variant.price_override }
      : {}),
    ...(primaryImage ? { primary_image: primaryImage } : {}),
    ...(keepTrackedPolicy && variant.effective_policy != null
      ? { effective_policy: variant.effective_policy }
      : keepTrackedPolicy
        ? { inventory_tracking_policy: variant.inventory_tracking_policy }
        : {}),
    ...(effectivePolicy === 'serialized_strict' &&
    typeof variant.available_units === 'number' &&
    Number.isFinite(variant.available_units)
      ? { available_units: variant.available_units }
      : {}),
  };
}

export function createCriticalCartProduct(
  product: CriticalCartSource
): CriticalCartProduct {
  return {
    available_conditions: product.available_conditions,
    brand: product.brand || 'OgaBassey',
    category: product.category,
    category_slug: product.category_slug,
    compare_at_price: product.compare_at_price,
    condition: normalizeCartCondition(product.condition),
    default_variant_id: product.default_variant_id,
    description: product.description || product.name,
    gtin: product.gtin || '',
    has_variants: product.has_variants,
    id: product.id,
    image: product.image,
    imageHint: product.imageHint || product.name,
    imageLarge: product.imageLarge || product.image,
    // NULL means managed (platform policy): only explicit false
    // disables the cart out-of-stock guard.
    manage_stock: product.manage_stock ?? true,
    // Retained for the cart aggregate pool cap: offer adds overwrite
    // stock with the selected allocation, so the cap reads stock_quantity.
    inventory_tracking_policy: product.inventory_tracking_policy,
    // Anchor-derived effective policy (preferred over the row policy
    // by the offer-stock helpers).
    effective_policy: product.effective_policy,
    mpn: product.mpn || product.slug || product.id,
    name: product.name,
    offers: product.offers,
    price: product.price,
    slug: product.slug,
    status: product.status,
    stock: Math.max(0, product.stock || 0),
    stock_quantity: product.stock_quantity,
    ...(product.variants
      ? { variants: product.variants.map(trimCriticalCartVariant) }
      : {}),
  };
}

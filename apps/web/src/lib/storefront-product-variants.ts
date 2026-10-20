import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { isStorefrontProductVariantPublic } from '@/lib/is-storefront-product-variant-public';
import type { ProductCondition, ProductVariant } from '@/lib/products';

const ALLOWED_PRODUCT_CONDITIONS = ['new', 'used', 'open_box'] as const;

function isAllowedProductCondition(
  condition: string | null | undefined
): condition is ProductCondition {
  return ALLOWED_PRODUCT_CONDITIONS.includes(
    normalizeCanonicalProductCondition(
      condition
    ) as (typeof ALLOWED_PRODUCT_CONDITIONS)[number]
  );
}

function normalizeStorefrontCondition(condition: string | null | undefined) {
  const normalized = normalizeCanonicalProductCondition(condition);
  return isAllowedProductCondition(normalized) ? normalized : undefined;
}

interface StorefrontVariantRecord {
  inventory_tracking_policy?: string | null;
  effective_policy?: string | null;
  available_units?: number | null;
  archived_at?: string | null;
  attributes?: Record<string, unknown> | null;
  condition?: string | null;
  deleted_at?: string | null;
  id: string;
  images?: unknown;
  is_active?: boolean | null;
  is_inventory_anchor?: boolean | null;
  merchant_id?: string | null;
  price_override?: number | string | null;
  primary_image?: string | null;
  product_id?: string | null;
  sku?: string | null;
  status?: string | null;
  stock_quantity?: number | null;
}

function normalizeVariantAttributes(
  attributes: Record<string, unknown> | null | undefined
) {
  const normalizedAttributes: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes || {})) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
      continue;
    }

    normalizedAttributes[key] = trimmedValue;
  }

  return normalizedAttributes;
}

function normalizeOptionalNumber(value: number | string | null | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'string') {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : undefined;
  }

  return undefined;
}

function normalizeVariantImages(images: unknown) {
  if (!Array.isArray(images)) {
    return undefined;
  }

  const normalizedImages = images.filter(
    (image): image is string => typeof image === 'string' && image.length > 0
  );

  return normalizedImages.length > 0 ? normalizedImages : undefined;
}

export function normalizeStorefrontProductVariants(
  variants: StorefrontVariantRecord[] | null | undefined,
  options: {
    merchantId: string;
    productId: string;
    /**
     * Parent effective stock (getEffectiveStock): a null variant quantity
     * inherits it, mirroring the price-options CTE. Mapping null to 0
     * would show an inheriting variant as out of stock on the PDP while
     * search sells it.
     */
    parentStock: number;
  }
): ProductVariant[] {
  return (variants || [])
    .filter(isStorefrontProductVariantPublic)
    .map((variant) => ({
      id: variant.id,
      ...(variant.inventory_tracking_policy === 'off' ||
      variant.inventory_tracking_policy === 'serialized_strict' ||
      variant.inventory_tracking_policy === 'serialized_then_unlimited'
        ? { inventory_tracking_policy: variant.inventory_tracking_policy }
        : {}),
      ...(variant.effective_policy === 'off' ||
      variant.effective_policy === 'serialized_strict' ||
      variant.effective_policy === 'serialized_then_unlimited'
        ? { effective_policy: variant.effective_policy }
        : {}),
      ...(typeof variant.available_units === 'number' &&
      Number.isFinite(variant.available_units)
        ? { available_units: variant.available_units }
        : {}),
      product_id: variant.product_id || options.productId,
      merchant_id: variant.merchant_id || options.merchantId,
      condition: normalizeStorefrontCondition(variant.condition),
      attributes: normalizeVariantAttributes(variant.attributes),
      price_override: normalizeOptionalNumber(variant.price_override),
      stock_quantity:
        typeof variant.stock_quantity === 'number' &&
        Number.isFinite(variant.stock_quantity)
          ? variant.stock_quantity
          : options.parentStock,
      images: normalizeVariantImages(variant.images),
      primary_image: variant.primary_image || undefined,
      sku: variant.sku || undefined,
    }));
}

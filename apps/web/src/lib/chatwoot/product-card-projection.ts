import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { isProductVariantPurchasable } from '@baci/shared/lib/is-product-variant-purchasable';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 120;
const MAX_OPTION_KEY_LENGTH = 40;
const MAX_OPTION_VALUE_LENGTH = 80;
const ALLOWED_CONDITIONS = new Set(['new', 'used', 'open_box']);
const ALLOWED_OPTION_KEYS = new Set([
  'capacity',
  'color',
  'colour',
  'configuration',
  'edition',
  'finish',
  'length',
  'material',
  'memory',
  'model',
  'ram',
  'size',
  'sim',
  'sim type',
  'storage',
  'style',
  'width',
]);

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
    availability: 'in_stock' | 'out_of_stock';
    condition?: 'new' | 'used' | 'open_box';
  }>;
};

export type ChatwootProductCardProjection =
  | { ok: true; product: ChatwootProductCard }
  | { ok: false; code: 'unsupported_condition_offers' | 'product_unavailable' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toPrice(value: unknown): number | null {
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || value.trim().length === 0)
  ) {
    return null;
  }
  const price = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function toImage(value: unknown): string | undefined {
  const candidate =
    typeof value === 'string'
      ? value
      : isRecord(value) && typeof value.url === 'string'
        ? value.url
        : null;
  if (!candidate || candidate.length > 2_048) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function projectAttributes(value: unknown): Record<string, string> | null {
  if (value == null) return {};
  if (!isRecord(value)) return null;
  const output: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (key.length > MAX_OPTION_KEY_LENGTH) return null;
    const cleanKey = key.trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (!ALLOWED_OPTION_KEYS.has(cleanKey)) continue;
    if (
      typeof rawValue !== 'string' ||
      rawValue.length > MAX_OPTION_VALUE_LENGTH
    ) {
      return null;
    }
    const cleanValue = rawValue.trim();
    if (cleanKey && cleanValue) output[cleanKey] = cleanValue;
  }
  return output;
}

function normalizedCondition(
  value: unknown
): 'new' | 'used' | 'open_box' | undefined {
  if (typeof value !== 'string') return undefined;
  const condition = normalizeCanonicalProductCondition(value);
  return ALLOWED_CONDITIONS.has(condition)
    ? (condition as 'new' | 'used' | 'open_box')
    : undefined;
}

function isPurchasableProduct(product: Record<string, unknown>): boolean {
  const policy = product.effective_policy ?? product.inventory_tracking_policy;
  if (policy === 'serialized_then_unlimited') return true;
  const stock = parentEffectiveStock(product);
  if (policy === 'serialized_strict')
    return Number.isFinite(stock) && stock > 0;
  const manageStock =
    typeof product.manage_stock === 'boolean' ? product.manage_stock : true;
  return !manageStock || (Number.isFinite(stock) && stock > 0);
}

function numericStock(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const stock = Number(value);
  return Number.isFinite(stock) ? stock : null;
}

function parentEffectiveStock(product: Record<string, unknown>): number {
  const quantity = numericStock(product.stock_quantity);
  const legacyStock = numericStock(product.stock);
  if ((quantity ?? 0) <= 0 && (legacyStock ?? 0) > 0) {
    return Math.max(0, Math.trunc(legacyStock ?? 0));
  }
  return Math.max(0, Math.trunc(quantity ?? 0));
}

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
    typeof product.name !== 'string' ||
    !product.name.trim() ||
    product.name.length > MAX_NAME_LENGTH ||
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
  const hasVariants = product.has_variants;
  const basePrice = toPrice(product.price);
  if (basePrice === null) return { ok: false, code: 'product_unavailable' };

  const rawVariants = product.product_variants;
  if (
    (hasVariants &&
      (product.variants_truncated === true ||
        !Array.isArray(rawVariants) ||
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
        !UUID_PATTERN.test(String(candidate.id ?? '')) ||
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
            parentEffectiveStock(product),
        }
      );
      const variantCondition =
        normalizedCondition(candidate.condition) ??
        normalizedCondition(product.condition);
      variants.push({
        id: candidate.id as string,
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
          attributes: variant.attributes,
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
  if (hasVariants && purchasableVariants.length === 0) {
    return { ok: false, code: 'product_unavailable' };
  }
  const available = hasVariants
    ? purchasableVariants.length > 0
    : isPurchasableProduct(product);
  const cardPrice = hasVariants
    ? Math.min(...purchasableVariants.map((variant) => variant.price))
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
      name: product.name.trim(),
      price: cardPrice,
      currency: input.currency,
      availability: available ? 'in_stock' : 'out_of_stock',
      ...(image ? { image } : {}),
      ...(cardCondition ? { condition: cardCondition } : {}),
      variants,
    },
  };
}

import { getEffectiveProductStock } from '@baci/shared';
import { getPrimaryProductImage } from '@/lib/product-image';
import type {
  QuizPrizeProduct,
  QuizPrizeProductRow,
  QuizPrizeVariantRow,
} from '@/schemas/quiz-prize-product';

export function isProductRow(value: unknown): value is QuizPrizeProductRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<QuizPrizeProductRow>;
  return (
    typeof row.id === 'string' &&
    typeof row.merchant_id === 'string' &&
    typeof row.name === 'string'
  );
}

export function isVariantRow(value: unknown): value is QuizPrizeVariantRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<QuizPrizeVariantRow>;
  return (
    typeof row.id === 'string' &&
    typeof row.merchant_id === 'string' &&
    typeof row.product_id === 'string'
  );
}

function variantLabel(variant: QuizPrizeVariantRow): string {
  if (variant.attributes && typeof variant.attributes === 'object') {
    const values = Object.values(variant.attributes)
      .filter(
        (value): value is string | number =>
          typeof value === 'string' || typeof value === 'number'
      )
      .map(String)
      .filter(Boolean);
    if (values.length > 0) return values.join(' / ').slice(0, 180);
  }
  return variant.sku?.trim() || variant.condition?.trim() || 'Variant';
}

export function mapBaseProduct(product: QuizPrizeProductRow): QuizPrizeProduct {
  const manageStock = product.manage_stock === true;
  const effectiveStock = manageStock ? getEffectiveProductStock(product) : null;
  const hasVariants = product.has_variants === true;
  return {
    available: !hasVariants && (!manageStock || (effectiveStock ?? 0) > 0),
    condition: product.condition?.trim() || 'unspecified',
    defaultVariantId: product.default_variant_id,
    effectiveStock,
    hasVariants,
    id: product.id,
    imageUrl: getPrimaryProductImage(product.images),
    manageStock,
    name: product.name,
    price: Number(product.price ?? 0),
    requiresVariantSelection: hasVariants,
    selectionId: `${product.id}:product`,
    variantId: null,
    variantLabel: null,
  };
}

export function mapVariantProduct(
  product: QuizPrizeProductRow,
  variant: QuizPrizeVariantRow
): QuizPrizeProduct {
  const manageStock = product.manage_stock === true;
  const stock = Number(variant.stock_quantity ?? 0);
  const effectiveStock = manageStock
    ? Math.max(0, Number.isFinite(stock) ? Math.trunc(stock) : 0)
    : null;
  const variantImage = getPrimaryProductImage([
    variant.primary_image ?? '',
    ...(variant.images ?? []),
  ]);
  return {
    available: !manageStock || (effectiveStock ?? 0) > 0,
    condition:
      variant.condition?.trim() || product.condition?.trim() || 'unspecified',
    defaultVariantId: product.default_variant_id,
    effectiveStock,
    hasVariants: true,
    id: product.id,
    imageUrl: variantImage ?? getPrimaryProductImage(product.images),
    manageStock,
    name: product.name,
    price: Number(variant.price_override ?? product.price ?? 0),
    requiresVariantSelection: false,
    selectionId: `${product.id}:${variant.id}`,
    variantId: variant.id,
    variantLabel: variantLabel(variant),
  };
}

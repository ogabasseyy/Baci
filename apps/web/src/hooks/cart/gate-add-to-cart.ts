import { logger } from '@/lib/logger';
import type { Product, ProductVariant } from '@/lib/products';
import { isProductVariantPurchasable } from '../../../../../packages/shared/src/lib/is-product-variant-purchasable';
import type { AddToCartOptions } from './cart-types';

interface GatedAdd {
  product: Product;
  options: AddToCartOptions | undefined;
}

function normalizeCartCondition(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'uk_used') return 'used';
  if (normalized === 'refurbished') return 'open_box';
  return normalized === 'new' ||
    normalized === 'open_box' ||
    normalized === 'used'
    ? normalized
    : '';
}

function getConditionRank(condition: string): number {
  if (condition === 'used') return 0;
  if (condition === 'open_box') return 1;
  if (condition === 'new') return 2;
  return 3;
}

type CartVariantLike = ProductVariant & {
  compare_at_price?: number | null;
  price?: number | null;
  price_modifier?: number | null;
};

function getVariantPrice(basePrice: number, variant: CartVariantLike): number {
  if (typeof variant.price_override === 'number') return variant.price_override;
  if (typeof variant.price === 'number') return variant.price;
  if (typeof variant.price_modifier === 'number') {
    return Math.max(0, basePrice + variant.price_modifier);
  }
  return basePrice;
}

export function resolveCartDefaultVariantSelection(product: Product) {
  const variants: CartVariantLike[] = product.variants || [];
  const purchasable = variants
    .map((variant, index) => ({ variant, index }))
    .filter(({ variant }) =>
      isProductVariantPurchasable(product.manage_stock, variant)
    );
  if (purchasable.length === 0) return null;

  const [{ variant }] = [...purchasable].sort((left, right) => {
    const leftRank = getConditionRank(
      normalizeCartCondition(left.variant.condition ?? product.condition)
    );
    const rightRank = getConditionRank(
      normalizeCartCondition(right.variant.condition ?? product.condition)
    );
    if (leftRank !== rightRank) return leftRank - rightRank;
    const leftPrice = getVariantPrice(product.price, left.variant);
    const rightPrice = getVariantPrice(product.price, right.variant);
    return leftPrice !== rightPrice
      ? leftPrice - rightPrice
      : left.index - right.index;
  });

  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(variant.attributes || {})) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) attributes[key] = trimmed;
  }
  const condition = normalizeCartCondition(
    variant.condition ?? product.condition
  );

  return {
    variant,
    attributes,
    color: attributes.color || undefined,
    condition: condition || undefined,
    storage: attributes.storage || undefined,
    price: getVariantPrice(product.price, variant),
    compareAtPrice:
      typeof variant.compare_at_price === 'number'
        ? variant.compare_at_price
        : typeof product.compare_at_price === 'number'
          ? product.compare_at_price
          : undefined,
  };
}

/**
 * Legacy add gating shared by both cart modes: default-variant resolution,
 * quiz-prize voucher stock exemption, out-of-stock and unresolved-variant
 * blocks. Returns null when the add must not proceed.
 */
export function gateAddToCart(
  product: Product,
  options?: AddToCartOptions
): GatedAdd | null {
  const defaultVariantSelection =
    product.has_variants && !options?.variantId
      ? resolveCartDefaultVariantSelection(product)
      : null;
  const normalizedOptions =
    defaultVariantSelection && !options?.variantId
      ? {
          ...options,
          variantId: defaultVariantSelection.variant.id,
          variantAttributes: defaultVariantSelection.attributes,
          color: options?.color ?? defaultVariantSelection.color,
          condition: options?.condition ?? defaultVariantSelection.condition,
          storage: options?.storage ?? defaultVariantSelection.storage,
        }
      : options;
  const productForCart =
    defaultVariantSelection && !options?.variantId
      ? {
          ...product,
          price: defaultVariantSelection.price,
          compare_at_price:
            defaultVariantSelection.compareAtPrice ?? product.compare_at_price,
          stock:
            defaultVariantSelection.variant.stock_quantity ?? product.stock,
        }
      : product;

  // A quiz-prize voucher line redeems a unit that was already reserved for
  // this shopper at award mint (create_quiz_product_prize_award_with_inventory
  // decrements stock and pins a reserved order). Public stock can therefore be
  // 0 — e.g. the last serialized unit — so the out-of-stock guard must NOT
  // block the winner from adding their own prize.
  const isQuizPrizeVoucherLine = Boolean(
    normalizedOptions?.quizAwardId || normalizedOptions?.quizVoucherToken
  );
  if (
    !isQuizPrizeVoucherLine &&
    productForCart.manage_stock &&
    (productForCart.stock ?? 0) <= 0
  ) {
    logger.warn({
      message: 'Attempted to add out-of-stock product to cart',
      productId: productForCart.id,
      productName: productForCart.name,
      stock: productForCart.stock,
    });
    return null;
  }

  if (product.has_variants && !normalizedOptions?.variantId) {
    logger.warn({
      message: 'Attempted to add variant product without selecting variant',
      productId: productForCart.id,
      productName: productForCart.name,
    });
    return null;
  }

  return { product: productForCart, options: normalizedOptions };
}

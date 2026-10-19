import { logger } from '@/lib/logger';
import type { Product } from '@/lib/products';
import { resolveDefaultVariantSelection } from '../../../../../packages/shared/src/lib/product-default-variant';
import type { AddToCartOptions } from './cart-types';

interface GatedAdd {
  product: Product;
  options: AddToCartOptions | undefined;
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
      ? resolveDefaultVariantSelection(product)
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

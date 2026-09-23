import { resolveDefaultVariantSelection } from '@baci/shared/lib';
import type { Product } from '@/lib/products';
import { generateCartItemId } from './cart-storage';
import type { AddToCartOptions, CartItem } from './cart-types';

/**
 * Index of the cart line `addToCart` would merge into for this
 * product/options, or -1 when the add creates a fresh line.
 *
 * Single source of truth for merge matching. The provider's `addToCart`
 * and every pre-add existence check (negotiated-price grants, Santa wishes)
 * must agree here: a check that reports "fresh" for a line `addToCart`
 * merges into lets a per-unit grant reprice previously saved units.
 *
 * Matching mirrors `addToCart` exactly, including default-variant
 * resolution for option-less adds and the ID-only legacy shape
 * (persisted lines without `cartItemId` still merge by product id).
 */
export function findMergingCartLineIndex(
  cart: CartItem[],
  product: Product,
  options?: AddToCartOptions
): number {
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
  const cartItemId = generateCartItemId(product.id, normalizedOptions);
  return cart.findIndex((item) => {
    if (item.cartItemId === cartItemId) return true;
    if (item.id !== product.id) return false;
    if (item.variantId !== normalizedOptions?.variantId) return false;
    if (normalizedOptions?.color || normalizedOptions?.storage) return false;
    return !item.cartItemId;
  });
}

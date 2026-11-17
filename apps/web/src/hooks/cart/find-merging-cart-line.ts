import { cartLineIdentity } from '@baci/shared/cart';
import { resolveDefaultVariantSelection } from '@baci/shared/lib/product-default-variant';
import type { Product } from '@/lib/products';
import { generateCartItemId } from './cart-storage';
import type {
  AddToCartOptions,
  CartItem,
  SharedCartDisplayItem,
} from './cart-types';
import {
  cartItemToIdentity,
  displayLineMatchesAddLane,
} from './shared-cart-display-identity';

/**
 * Index of the cart line `addToCart` would merge into for this
 * product/options, or -1 when the add creates a fresh line.
 *
 * Single source of truth for merge matching. The provider's `addToCart`
 * and every pre-add existence check (negotiated-price grants, Santa wishes,
 * PDP in-cart controls) must agree here: a check that reports "fresh" for a
 * line `addToCart` merges into lets a per-unit grant reprice previously
 * saved units or hides in-cart controls on shared-cart storefronts.
 *
 * Matching mirrors `addToCart` across both legacy local carts (where
 * `cartItemId` is `generateCartItemId(...)` or omitted on historical rows)
 * and shared carts (where `cartItemId` is a server UUID or `temp:` id and
 * lines match by canonical `cartLineIdentity` + attachment lane).
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
  const productRecord = product as unknown as Record<string, unknown>;
  const voucherToken =
    normalizedOptions?.quizVoucherToken ??
    (typeof productRecord.quizVoucherToken === 'string'
      ? productRecord.quizVoucherToken
      : undefined);
  const voucherAwardId =
    normalizedOptions?.quizAwardId ??
    (typeof productRecord.quizAwardId === 'string'
      ? productRecord.quizAwardId
      : undefined);
  const sharedIdentityKey = normalizedOptions?.offerId
    ? null
    : cartLineIdentity(
        cartItemToIdentity({
          condition: normalizedOptions?.condition,
          id: product.id,
          selectedColor: normalizedOptions?.color,
          selectedColorValue: normalizedOptions?.colorValue,
          selectedStorage: normalizedOptions?.storage,
          secondaryColor: normalizedOptions?.secondaryColor,
          secondaryColorValue: normalizedOptions?.secondaryColorValue,
          variantAttributes: normalizedOptions?.variantAttributes,
          variantId: normalizedOptions?.variantId,
        })
      );

  return cart.findIndex((item) => {
    if (item.cartItemId === cartItemId) return true;
    const sharedCandidate = item as Partial<SharedCartDisplayItem>;
    const isSharedCartLine =
      typeof sharedCandidate.serverLineId === 'string' ||
      (typeof sharedCandidate.pendingTempId === 'string' &&
        sharedCandidate.pendingTempId.length > 0) ||
      (typeof item.cartItemId === 'string' &&
        item.cartItemId.startsWith('temp:'));
    if (
      isSharedCartLine &&
      sharedIdentityKey !== null &&
      !item.offerId &&
      cartLineIdentity(cartItemToIdentity(item)) === sharedIdentityKey &&
      displayLineMatchesAddLane(item as SharedCartDisplayItem, {
        voucherToken,
        voucherAwardId,
      })
    ) {
      return true;
    }
    if (item.id !== product.id) return false;
    if (item.variantId !== normalizedOptions?.variantId) return false;
    if (item.offerId !== normalizedOptions?.offerId) return false;
    if (item.condition !== normalizedOptions?.condition) return false;
    if (normalizedOptions?.color || normalizedOptions?.storage) return false;
    return !item.cartItemId;
  });
}

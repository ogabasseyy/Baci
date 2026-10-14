import { resolveAddedLineAssurance } from '@baci/shared/lib';
import type { AddToCartOptions, CartItem } from './cart-types';

/**
 * Cart-line merge policy for adds.
 *
 * Split out of use-cart.tsx (Boy Scout Rule): line identity (V2 id, legacy
 * V1 id, ID-less legacy match) plus the per-line assurance default/merge
 * decision for both the merge-into-existing and append-new-line paths.
 */
export interface CartLineMergeCandidate {
  productId: string;
  cartItemId: string;
  options?: AddToCartOptions;
  normalizedOptions?: AddToCartOptions;
}

export function matchesCartLineForAdd(
  item: CartItem,
  candidate: CartLineMergeCandidate
): boolean {
  const { productId, cartItemId, options, normalizedOptions } = candidate;

  // 1. Direct V2 Match (:: separator)
  if (item.cartItemId === cartItemId) return true;

  // 2. Legacy V1 Match (old - separator format stored in cart)
  // A V1 id encodes variant/color/storage/condition but never the
  // exact condition offer, so its price basis is unknown: an
  // exact-offer add must not merge into it (mirrors the offer guard
  // on ID-less legacy lines below).
  if (
    item.cartItemId?.includes('-') &&
    !item.cartItemId.includes('::') &&
    !normalizedOptions?.offerId
  ) {
    // Rebuild what the old generateCartItemId would have produced
    const legacyParts = [productId];
    if (options?.variantId) legacyParts.push(options.variantId);
    if (options?.color) legacyParts.push(options.color);
    if (options?.storage) legacyParts.push(options.storage);
    if (options?.condition) legacyParts.push(options.condition);
    if (item.cartItemId === legacyParts.join('-')) return true;
  }

  // 3. Legacy Match (if item has no cartItemId)
  if (!item.cartItemId && item.id === productId) {
    const itemVar = item.variantId;
    const newVar = normalizedOptions?.variantId;
    if (itemVar !== newVar) return false;
    if (item.offerId !== normalizedOptions?.offerId) return false;

    // Check if V2 options are used (legacy items have none)
    // If adding item with V2 options, don't match legacy item
    if (normalizedOptions?.color || normalizedOptions?.storage) return false;

    return true;
  }
  return false;
}

export function findMatchingCartLineIndex(
  prev: CartItem[],
  candidate: CartLineMergeCandidate
): number {
  return prev.findIndex((item) => matchesCartLineForAdd(item, candidate));
}

export interface CartLineAssurancePolicy {
  smartCartProEnabled: boolean;
  merchantSlug: string | null | undefined;
  shippingInsuranceEnabled?: boolean;
}

/**
 * Per-line assurance choice for an add: quiz/voucher (free-prize) lines
 * never default on, an explicit incoming choice always wins, and merges
 * otherwise preserve the stored choice. Callers with the live merchant
 * setting forward it so an explicit opt-out disables the default; no
 * legacy caller enables SmartCartPro today, so omitting it preserves
 * current behavior.
 */
export function resolveCartLineAssurance(
  normalizedOptions: AddToCartOptions | undefined,
  existing: { hasAssurance?: boolean } | undefined,
  policy: CartLineAssurancePolicy
): boolean | undefined {
  return resolveAddedLineAssurance(normalizedOptions?.hasAssurance, existing, {
    smartCartProEnabled: policy.smartCartProEnabled,
    merchantSlug: policy.merchantSlug,
    hasQuizVoucher: Boolean(
      normalizedOptions?.quizAwardId || normalizedOptions?.quizVoucherToken
    ),
    shippingInsuranceEnabled: policy.shippingInsuranceEnabled,
  });
}

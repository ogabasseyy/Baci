import { resolveAddedLineAssurance } from '@baci/shared/lib';
import type { CartItem } from './cart-store.types';

export function createCartLineId(
  item: Omit<CartItem, 'id'>,
  sequence: number
): string {
  // Award IDs are stable after redemption; pending awards use voucher_token,
  // and plain products use the persisted monotonic sequence for new lines.
  const voucherIdentifier = item.voucher_award_id ?? item.voucher_token;
  const uniquePart = voucherIdentifier
    ? `${voucherIdentifier}::${sequence}`
    : `cart-line::${sequence}`;

  return `${item.product_id}::${item.variant_id || 'default'}::${uniquePart}`;
}

function getNormalizedVoucherIdentifier(value: string | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : null;
}

function hasVoucherIdentifier(
  item: Pick<CartItem, 'voucher_award_id' | 'voucher_token'>
) {
  return Boolean(
    getNormalizedVoucherIdentifier(item.voucher_award_id) ||
      getNormalizedVoucherIdentifier(item.voucher_token)
  );
}

function hasMatchingVoucherIdentifier(
  existingItem: Pick<CartItem, 'voucher_award_id' | 'voucher_token'>,
  incomingItem: Pick<CartItem, 'voucher_award_id' | 'voucher_token'>
) {
  const existingAwardId = getNormalizedVoucherIdentifier(
    existingItem.voucher_award_id
  );
  const incomingAwardId = getNormalizedVoucherIdentifier(
    incomingItem.voucher_award_id
  );
  const existingToken = getNormalizedVoucherIdentifier(
    existingItem.voucher_token
  );
  const incomingToken = getNormalizedVoucherIdentifier(
    incomingItem.voucher_token
  );

  return (
    (existingAwardId !== null && existingAwardId === incomingAwardId) ||
    (existingToken !== null && existingToken === incomingToken)
  );
}

export function mergeExistingCartItem(
  existingItem: CartItem,
  incomingItem: Omit<CartItem, 'id'>,
  policy: {
    smartCartProEnabled: boolean;
    merchantSlug: string | null | undefined;
  }
): CartItem {
  const newQuantity = existingItem.quantity + incomingItem.quantity;
  const isVoucherLine =
    hasVoucherIdentifier(existingItem) || hasVoucherIdentifier(incomingItem);

  return {
    ...existingItem,
    ...incomingItem,
    id: existingItem.id,
    // The matcher wildcards a missing dimension on either side, but the
    // spread above would then let an explicit undefined blank the stored
    // value. Matched lines agree wherever both sides are set, so keeping
    // the existing value when the incoming add omits it is always safe.
    color: incomingItem.color ?? existingItem.color,
    storage: incomingItem.storage ?? existingItem.storage,
    condition: incomingItem.condition ?? existingItem.condition,
    voucher_award_id:
      incomingItem.voucher_award_id ?? existingItem.voucher_award_id,
    voucher_token: incomingItem.voucher_token ?? existingItem.voucher_token,
    quantity: isVoucherLine
      ? 1
      : existingItem.max_quantity
        ? Math.min(newQuantity, existingItem.max_quantity)
        : newQuantity,
    negotiatedPrice: existingItem.negotiatedPrice,
    negotiationStatus: existingItem.negotiationStatus,
    hasAssurance: resolveAddedLineAssurance(
      incomingItem.hasAssurance,
      existingItem,
      { ...policy, hasQuizVoucher: isVoucherLine }
    ),
    assuranceRate: existingItem.assuranceRate,
  };
}

function areEquivalentCartAttributes(
  existingValue: string | undefined,
  incomingValue: string | undefined
) {
  const normalizedExistingValue = existingValue ?? null;
  const normalizedIncomingValue = incomingValue ?? null;

  return (
    normalizedExistingValue === normalizedIncomingValue ||
    normalizedExistingValue === null ||
    normalizedIncomingValue === null
  );
}

export function isSameCartLine(
  existingItem: CartItem,
  incomingItem: Omit<CartItem, 'id'>
) {
  const existingHasVoucher = hasVoucherIdentifier(existingItem);
  const incomingHasVoucher = hasVoucherIdentifier(incomingItem);

  if (existingHasVoucher || incomingHasVoucher) {
    if (!existingHasVoucher || !incomingHasVoucher) {
      return false;
    }

    if (!hasMatchingVoucherIdentifier(existingItem, incomingItem)) {
      return false;
    }
  }

  if (existingItem.product_id !== incomingItem.product_id) {
    return false;
  }

  const existingVariantId = existingItem.variant_id ?? null;
  const incomingVariantId = incomingItem.variant_id ?? null;

  if (existingVariantId !== incomingVariantId) {
    return false;
  }

  if ((existingItem.offer_id ?? null) !== (incomingItem.offer_id ?? null)) {
    return false;
  }

  if (existingVariantId || incomingVariantId) {
    return (
      areEquivalentCartAttributes(existingItem.color, incomingItem.color) &&
      areEquivalentCartAttributes(existingItem.storage, incomingItem.storage) &&
      areEquivalentCartAttributes(
        existingItem.condition,
        incomingItem.condition
      )
    );
  }

  return (
    (existingItem.color ?? null) === (incomingItem.color ?? null) &&
    (existingItem.storage ?? null) === (incomingItem.storage ?? null) &&
    (existingItem.condition ?? null) === (incomingItem.condition ?? null)
  );
}

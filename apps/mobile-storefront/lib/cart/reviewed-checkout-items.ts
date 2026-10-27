import type { NativeCheckoutSnapshot } from '@/schemas/cart-checkout-snapshot';
import type { CartItem } from '@/stores/cart-store.types';
import { NativeCartError } from './native-cart-error';

/** Product shells stay local; quantities, prices and offer validity come from the review. */
export function reviewedCheckoutItems(
  cached: CartItem[],
  review: NativeCheckoutSnapshot
): CartItem[] {
  return review.lines.map((line) => {
    const item = cached.find(
      (candidate) =>
        candidate.id === line.id && candidate.product_id === line.productId
    );
    if (!item) throw new NativeCartError('refresh_required');
    const isVoucher = Boolean(line.voucherToken && line.voucherAwardId);
    const negotiationStatus = line.negotiationInvalidated
      ? undefined
      : line.negotiationStatus;
    return {
      ...item,
      product_id: line.productId,
      variant_id: line.variantId ?? undefined,
      offer_id: line.offerId ?? undefined,
      condition: line.condition ?? undefined,
      variant_attributes: line.options,
      color: line.options.color,
      storage: line.options.storage,
      quantity: line.quantity,
      price: isVoucher ? 0 : line.validatedUnitPriceMinor / 100,
      negotiatedPrice:
        !isVoucher &&
        !line.negotiationInvalidated &&
        line.negotiatedUnitPriceMinor !== null
          ? line.negotiatedUnitPriceMinor / 100
          : undefined,
      negotiationStatus:
        negotiationStatus === 'accepted' ||
        negotiationStatus === 'pending' ||
        negotiationStatus === 'rejected'
          ? negotiationStatus
          : undefined,
      hasAssurance: line.hasAssurance,
      assuranceRate: line.assuranceRate ?? item.assuranceRate,
      voucher_token: isVoucher ? (line.voucherToken ?? undefined) : undefined,
      voucher_award_id: isVoucher
        ? (line.voucherAwardId ?? undefined)
        : undefined,
    };
  });
}

import { z } from 'zod';

/**
 * Order-item condition-offer alias fields and cross-field refinements.
 *
 * Split out of orders.ts (Boy Scout Rule): the exact-offer add path names
 * one live condition offer per line, which is mutually exclusive with both
 * variant selection and quiz-voucher redemption on the same line.
 */
export const orderItemOfferAliasFields = {
  offerId: z.string().optional(),
  offer_id: z.string().optional(),
};

export interface OrderItemOfferAliasData {
  variantId?: unknown;
  variant_id?: unknown;
  offerId?: unknown;
  offer_id?: unknown;
  voucherAwardId?: unknown;
  voucherToken?: unknown;
  voucher_award_id?: unknown;
  voucher_token?: unknown;
}

export const OFFER_VARIANT_EXCLUSION_ERROR =
  'variantId/variant_id and offerId/offer_id cannot be combined on one order item';

export function offerVariantExclusionHolds(data: OrderItemOfferAliasData) {
  return (
    !(data.variantId || data.variant_id) || !(data.offerId || data.offer_id)
  );
}

export const OFFER_VOUCHER_EXCLUSION_ERROR =
  'offerId/offer_id cannot be combined with a quiz-voucher redemption on one order item';

export function offerVoucherExclusionHolds(data: OrderItemOfferAliasData) {
  return (
    !(
      data.voucherAwardId ||
      data.voucherToken ||
      data.voucher_award_id ||
      data.voucher_token
    ) || !(data.offerId || data.offer_id)
  );
}

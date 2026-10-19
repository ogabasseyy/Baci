import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
  type CanonicalSubtotalItem,
  computeCanonicalOrderSubtotal,
  isCanonicalOrderSubtotalUuidError,
} from '@/lib/checkout/canonical-order-subtotal';
import { computeDiscountAmountForSubtotal } from '@/lib/checkout/discount-amount';
import { resolveLoyaltyCheckoutCode } from '@/lib/checkout/resolve-loyalty-checkout-code';
import { logger } from '@/lib/logger';
import { storefrontDiscountCodeRowSchema } from '@/schemas/storefront-discount';

export type LoyaltyCheckoutPreparation =
  | {
      ok: true;
      canonicalOrderSubtotal: number | null;
      discountCodeId: string | null;
      loyaltyRedemptionId: string | null;
      discountCodeAmount: number;
    }
  | { ok: false; response: NextResponse };

/**
 * Discount/loyalty checkout preparation for POST /api/orders (issue
 * #3165), extracted from the oversized orders route: resolve the
 * requested code server-side (merchant discount code first, loyalty
 * RDM-* fallback), compute the canonical pre-discount subtotal, apply
 * the loyalty maximum-redemption-percentage cap snapshotted at mint,
 * and derive the discount amount. Eligibility and targeting stay
 * enforced authoritatively and replay-safely in the wrapper RPC; this
 * helper only resolves economics. Response objects are byte-identical
 * to the inline flow it replaced.
 */
export async function prepareLoyaltyCheckout({
  supabase,
  merchantId,
  requestedDiscountCode,
  hasVoucherItem,
  requestedSavingsRedemption,
  items,
  offerPrices,
  isIdempotentOfferOrderReplay = false,
}: {
  supabase: SupabaseClient;
  merchantId: string;
  requestedDiscountCode: string;
  hasVoucherItem: boolean;
  requestedSavingsRedemption: boolean;
  items: CanonicalSubtotalItem[];
  offerPrices?: Map<string, number>;
  isIdempotentOfferOrderReplay?: boolean;
}): Promise<LoyaltyCheckoutPreparation> {
  if (hasVoucherItem) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: 'DISCOUNT_CODE_VOUCHER_COMBINATION_UNSUPPORTED',
          error: 'Failed to create order',
        },
        { status: 400 }
      ),
    };
  }
  if (requestedSavingsRedemption) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: 'DISCOUNT_CODE_SAVINGS_COMBINATION_UNSUPPORTED',
          error: 'Failed to create order',
        },
        { status: 400 }
      ),
    };
  }

  // include_inactive=true: resolve even a deactivated code so a retry
  // can reach the replay-aware wrapper; the wrapper decides replay vs
  // a fresh `code_inactive` rejection.
  const { data: discountRows, error: discountLookupError } = await supabase.rpc(
    'get_storefront_discount_code',
    {
      p_merchant_id: merchantId,
      p_code: requestedDiscountCode,
      p_include_inactive: true,
    }
  );
  if (discountLookupError) {
    // Don't mask a server/DB failure as an invalid-code 400.
    logger.error({
      message: 'Discount code lookup failed',
      error: discountLookupError,
      merchantId,
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      ),
    };
  }
  const parsedDiscountArray = storefrontDiscountCodeRowSchema
    .array()
    .safeParse(discountRows);
  const parsedDiscountSingle = parsedDiscountArray.success
    ? null
    : storefrontDiscountCodeRowSchema.safeParse(discountRows);
  const discountRow = parsedDiscountArray.success
    ? (parsedDiscountArray.data[0] ?? null)
    : parsedDiscountSingle?.success
      ? parsedDiscountSingle.data
      : null;

  // Normalized code economics — exactly one of discountCodeId /
  // loyaltyRedemptionId is set below.
  let discountCodeId: string | null = null;
  let loyaltyRedemptionId: string | null = null;
  let loyaltyMaxRedemptionPercentage: number | null = null;
  let codeDiscountType: 'fixed' | 'percentage';
  let codeDiscountValue: number;
  let codeMaximumDiscountAmount: number | null;
  if (discountRow?.is_active) {
    discountCodeId = discountRow.id;
    codeDiscountType =
      discountRow.discount_type === 'fixed_amount' ? 'fixed' : 'percentage';
    codeDiscountValue = Number(discountRow.discount_value);
    codeMaximumDiscountAmount = discountRow.maximum_discount_amount;
  } else {
    const loyaltyResolution = await resolveLoyaltyCheckoutCode({
      supabase,
      merchantId,
      code: requestedDiscountCode,
    });
    if (!loyaltyResolution.ok && discountRow) {
      // An inactive merchant code with no loyalty match keeps the
      // merchant path so the wrapper answers code_inactive (or replays
      // its claimed order) exactly as before. A deactivated code that
      // DOES match a loyalty redemption — e.g. a legacy collision
      // reconciled by migration 20261010000025 — falls through to the
      // loyalty redemption instead of dying as code_inactive.
      discountCodeId = discountRow.id;
      codeDiscountType =
        discountRow.discount_type === 'fixed_amount' ? 'fixed' : 'percentage';
      codeDiscountValue = Number(discountRow.discount_value);
      codeMaximumDiscountAmount = discountRow.maximum_discount_amount;
    } else if (!loyaltyResolution.ok) {
      return { ok: false, response: loyaltyResolution.response };
    } else {
      loyaltyRedemptionId = loyaltyResolution.redemptionId;
      codeDiscountType = loyaltyResolution.discountType;
      codeDiscountValue = loyaltyResolution.discountValue;
      loyaltyMaxRedemptionPercentage =
        loyaltyResolution.maxRedemptionPercentage;
      codeMaximumDiscountAmount = null;
    }
  }

  // F1 (offer economics): a confirmed idempotent retry replays the
  // stored order, so live-offer-dependent recomputation is bypassed —
  // the subtotal helper throws when verified offer economics are
  // absent, which would 500 a retry the RPC would otherwise replay.
  // Code identity is still resolved above; the amount stays 0 because
  // the RPC ignores it on replay and its request-hash check rejects
  // true conflicts first.
  if (isIdempotentOfferOrderReplay) {
    return {
      ok: true,
      canonicalOrderSubtotal: null,
      discountCodeId,
      loyaltyRedemptionId,
      discountCodeAmount: 0,
    };
  }

  let canonicalOrderSubtotal: number | null;
  try {
    canonicalOrderSubtotal = await computeCanonicalOrderSubtotal({
      items,
      merchantId,
      offerPrices,
      supabase,
    });
  } catch (subtotalError) {
    if (isCanonicalOrderSubtotalUuidError(subtotalError)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Failed to create order', details: 'invalid_items' },
          { status: 400 }
        ),
      };
    }
    logger.error({
      error: subtotalError,
      merchantId,
      message: 'Discount canonical subtotal recompute failed',
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      ),
    };
  }
  if (canonicalOrderSubtotal == null) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Failed to create order', details: 'invalid_items' },
        { status: 400 }
      ),
    };
  }

  // The loyalty cap is a percentage of the subtotal (snapshotted at
  // mint); convert now that the canonical subtotal is known.
  if (loyaltyMaxRedemptionPercentage != null) {
    codeMaximumDiscountAmount = Math.round(
      (canonicalOrderSubtotal * loyaltyMaxRedemptionPercentage) / 100
    );
  }

  const discountCodeAmount = computeDiscountAmountForSubtotal(
    {
      discount_type: codeDiscountType,
      discount_value: codeDiscountValue,
      maximum_discount_amount: codeMaximumDiscountAmount,
    },
    canonicalOrderSubtotal
  );

  return {
    ok: true,
    canonicalOrderSubtotal,
    discountCodeId,
    loyaltyRedemptionId,
    discountCodeAmount,
  };
}

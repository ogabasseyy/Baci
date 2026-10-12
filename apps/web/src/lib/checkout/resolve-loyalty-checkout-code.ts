import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { isLoyaltyCodeCurrencyCurrent } from '@/lib/checkout/is-loyalty-code-currency-current';
import { logger } from '@/lib/logger';
import { loyaltyCheckoutCodeRowSchema } from '@/schemas/storefront-discount';

export type LoyaltyCheckoutCodeResolution =
  | {
      ok: true;
      redemptionId: string;
      discountType: 'fixed' | 'percentage';
      discountValue: number;
    }
  | { ok: false; response: NextResponse };

/**
 * Loyalty fallback for order checkout (issue #3165): RDM-* codes live in
 * reward_redemptions, which the merchant-code lookup never reads.
 * Resolve read-only; the loyalty wrapper RPC re-verifies used /
 * expired / minimum / amount authoritatively, so resolve-time state is
 * NOT gated here — a used code must still reach the wrapper for
 * replay-first idempotent retries. Only the bridgeable shape (discount
 * type + positive value) is filtered: other reward types are honored
 * through manual/fulfillment channels.
 */
export async function resolveLoyaltyCheckoutCode({
  supabase,
  merchantId,
  code,
}: {
  supabase: SupabaseClient;
  merchantId: string;
  code: string;
}): Promise<LoyaltyCheckoutCodeResolution> {
  const { data: loyaltyRows, error: loyaltyLookupError } = await supabase.rpc(
    'get_loyalty_redemption_for_checkout',
    {
      p_merchant_id: merchantId,
      p_code: code,
    }
  );
  if (loyaltyLookupError) {
    logger.error({
      message: 'Loyalty code lookup failed',
      error: loyaltyLookupError,
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
  const parsedLoyaltyArray = loyaltyCheckoutCodeRowSchema
    .array()
    .safeParse(loyaltyRows);
  const parsedLoyaltySingle = parsedLoyaltyArray.success
    ? null
    : loyaltyCheckoutCodeRowSchema.safeParse(loyaltyRows);
  const loyaltyRow = parsedLoyaltyArray.success
    ? (parsedLoyaltyArray.data[0] ?? null)
    : parsedLoyaltySingle?.success
      ? parsedLoyaltySingle.data
      : null;
  const loyaltyValue = Number(loyaltyRow?.reward_value);
  // Plain 'discount' is fixed by convention (mirrors the order
  // wrapper's allowlist; only discount_percentage is proportional).
  const loyaltyBridgeable =
    loyaltyRow != null &&
    (loyaltyRow.reward_type === 'discount' ||
      loyaltyRow.reward_type === 'discount_fixed' ||
      loyaltyRow.reward_type === 'discount_percentage') &&
    Number.isFinite(loyaltyValue) &&
    loyaltyValue > 0;
  if (!loyaltyBridgeable || loyaltyRow == null) {
    return {
      ok: false,
      response: NextResponse.json(
        { code: 'discount_code_invalid', error: 'Invalid discount code' },
        { status: 400 }
      ),
    };
  }
  const discountType =
    loyaltyRow.reward_type === 'discount_percentage' ? 'percentage' : 'fixed';
  // Fixed codes are denominated in their issuance currency (stamped at
  // mint): if the merchant's currency has moved since, the numeric
  // value no longer means what the customer paid for. Collapse to the
  // generic invalid (no currency oracle); the order wrapper enforces
  // the same gate authoritatively. A failed merchant lookup skips the
  // preview gate and lets the wrapper decide.
  if (
    discountType === 'fixed' &&
    loyaltyRow.issuance_currency &&
    !(await isLoyaltyCodeCurrencyCurrent(
      supabase,
      merchantId,
      loyaltyRow.issuance_currency
    ))
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { code: 'discount_code_invalid', error: 'Invalid discount code' },
        { status: 400 }
      ),
    };
  }
  return {
    ok: true,
    redemptionId: loyaltyRow.redemption_id,
    discountType,
    discountValue: loyaltyValue,
  };
}

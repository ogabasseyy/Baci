import { type NextRequest, NextResponse } from 'next/server';
import { computeDiscountAmountForSubtotal } from '@/lib/checkout/discount-amount';
import { isLoyaltyCodeCurrencyCurrent } from '@/lib/checkout/is-loyalty-code-currency-current';
import { logger } from '@/lib/logger';
import { formatPayoutOnlyCurrency } from '@/lib/resolve-merchant-currency';
import { createAnonClient } from '@/lib/supabase/anon';
import { createServiceClient } from '@/lib/supabase/service';
import {
  loyaltyCheckoutCodeRowSchema,
  storefrontDiscountCodeRowSchema,
  storefrontDiscountValidateSchema,
} from '@/schemas/storefront-discount';
import { lookupErrorResponse } from './lookup-error-response';

// Dead/inapplicable codes collapse to generic invalid (no probing oracle).
// All such responses are 200: the code parsed, it just does not apply.
function invalidCodeResponse(message = 'Invalid discount code') {
  return NextResponse.json({ valid: false, error: message }, { status: 200 });
}

/**
 * POST /api/storefront/discount/validate
 * Validates a discount code via SECURITY DEFINER RPCs. CSRF
 * exemption: proxy rate limiting + read-only RPC mitigate. Privilege
 * split (issue #3696): the merchant path stays on the anon client,
 * but the loyalty resolver no longer grants anon/authenticated
 * EXECUTE (enumeration oracle), so only that call goes through the
 * service-role client. Abuse control stays at the proxy.
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { valid: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }
    const parsed = storefrontDiscountValidateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          valid: false,
          error: 'Invalid input',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { merchant_id, code, cart_total } = parsed.data;
    const supabase = createAnonClient();

    const { data, error } = await supabase.rpc('get_storefront_discount_code', {
      p_merchant_id: merchant_id,
      p_code: code,
    });

    if (error) {
      return lookupErrorResponse(
        'Discount code lookup failed',
        error,
        merchant_id
      );
    }

    const parsedArray = storefrontDiscountCodeRowSchema.array().safeParse(data);
    const parsedSingle = parsedArray.success
      ? null
      : storefrontDiscountCodeRowSchema.safeParse(data);
    if (!parsedArray.success && !parsedSingle?.success) {
      return invalidCodeResponse();
    }
    const discountCode = parsedArray.success
      ? (parsedArray.data[0] ?? null)
      : (parsedSingle?.data ?? null);

    if (!discountCode) {
      // Service-role only for the loyalty resolver (issue #3696):
      // anon/authenticated lost EXECUTE, so the shared anon client
      // would 403 here. Everything else on this route stays anon.
      const serviceSupabase = createServiceClient();
      const { data: loyaltyData, error: loyaltyError } =
        await serviceSupabase.rpc('get_loyalty_redemption_for_checkout', {
          p_merchant_id: merchant_id,
          p_code: code,
        });
      if (loyaltyError) {
        return lookupErrorResponse(
          'Loyalty code lookup failed',
          loyaltyError,
          merchant_id
        );
      }
      const parsedLoyaltyArray = loyaltyCheckoutCodeRowSchema
        .array()
        .safeParse(loyaltyData);
      const parsedLoyaltySingle = parsedLoyaltyArray.success
        ? null
        : loyaltyCheckoutCodeRowSchema.safeParse(loyaltyData);
      const loyaltyCode = parsedLoyaltyArray.success
        ? (parsedLoyaltyArray.data[0] ?? null)
        : (parsedLoyaltySingle?.data ?? null);
      const loyaltyValue = Number(loyaltyCode?.reward_value);
      if (
        loyaltyCode != null &&
        (loyaltyCode.reward_type === 'discount' ||
          loyaltyCode.reward_type === 'discount_fixed' ||
          loyaltyCode.reward_type === 'discount_percentage') &&
        Number.isFinite(loyaltyValue) &&
        loyaltyValue > 0 &&
        // The wrapper fails closed when the purchase minimum is
        // unknowable (null snapshot, deleted reward); validation must
        // not accept a code order creation will reject.
        loyaltyCode.minimum_known &&
        // Mirror loyalty_reward_value_is_usable: a discount_percentage
        // above 100 can never apply at checkout (the wrapper rejects
        // the snapshot), so validation must not report it as applied.
        // Plain discount/discount_fixed values are fixed amounts here.
        (loyaltyCode.reward_type !== 'discount_percentage' ||
          loyaltyValue <= 100)
      ) {
        // A used code is a checkout replay candidate, not a fresh
        // redemption: after a reload the shopper re-enters the code
        // and this preview is how the applied discount is
        // reconstructed so the persisted checkout key can reach the
        // replay-aware order wrapper (which authoritatively decides
        // replay vs already-used). Used codes therefore skip the
        // used/expired/currency/minimum gates below; an unused code
        // keeps every gate.
        if (
          !loyaltyCode.used &&
          loyaltyCode.expires_at &&
          new Date(loyaltyCode.expires_at) < new Date()
        ) {
          return invalidCodeResponse();
        }
        // Currency gate first (a mismatched code can never validate).
        if (
          !loyaltyCode.used &&
          (loyaltyCode.reward_type !== 'discount_percentage' ||
            Number(loyaltyCode.minimum_order_amount) > 0) &&
          loyaltyCode.issuance_currency &&
          !(await isLoyaltyCodeCurrencyCurrent(
            supabase,
            merchant_id,
            loyaltyCode.issuance_currency
          ))
        ) {
          return invalidCodeResponse();
        }
        // Accepted oracle (low): the minimum message stays distinct.
        if (
          !loyaltyCode.used &&
          loyaltyCode.minimum_order_amount != null &&
          cart_total < Number(loyaltyCode.minimum_order_amount)
        ) {
          // Threshold label currency.
          const { data: merchantRow, error: merchantError } = await supabase
            .from('merchants')
            .select('country, payout_currency')
            .eq('id', merchant_id)
            .maybeSingle();
          const minimumAmount = Number(loyaltyCode.minimum_order_amount);
          const minimumLabel = merchantError
            ? minimumAmount.toLocaleString()
            : formatPayoutOnlyCurrency(
                minimumAmount,
                {
                  country: merchantRow?.country ?? null,
                  payout_currency: merchantRow?.payout_currency ?? null,
                },
                { maximumFractionDigits: 0 }
              );
          return invalidCodeResponse(
            `Minimum purchase of ${minimumLabel} required`
          );
        }
        const loyaltyDiscountType =
          loyaltyCode.reward_type === 'discount_percentage'
            ? 'percentage'
            : 'fixed';
        const loyaltyDiscountAmount = computeDiscountAmountForSubtotal(
          {
            discount_type: loyaltyDiscountType,
            discount_value: loyaltyValue,
            // Max redemption percentage (mint snapshot) caps the share.
            maximum_discount_amount:
              loyaltyCode.max_redemption_percentage != null
                ? Math.round(
                    (cart_total *
                      Number(loyaltyCode.max_redemption_percentage)) /
                      100
                  )
                : null,
          },
          cart_total
        );
        // Zero computed discount collapses to invalid (checkout rejects).
        if (loyaltyDiscountAmount <= 0) {
          return invalidCodeResponse();
        }
        // Effective value (explicit null discount_code_id).
        const effectiveDiscountValue =
          loyaltyDiscountType === 'percentage'
            ? cart_total > 0
              ? Math.round((loyaltyDiscountAmount / cart_total) * 10000) / 100
              : 0
            : loyaltyDiscountAmount;
        return NextResponse.json({
          valid: true,
          discount_code_id: null,
          code,
          discount_type: loyaltyDiscountType,
          discount_value: effectiveDiscountValue,
          discount_amount: loyaltyDiscountAmount,
          minimum_order: loyaltyCode.minimum_order_amount
            ? Number(loyaltyCode.minimum_order_amount)
            : undefined,
          description: loyaltyCode.reward_name,
        });
      }
    }

    if (!discountCode) {
      return invalidCodeResponse();
    }

    if (
      discountCode.starts_at &&
      new Date(discountCode.starts_at) > new Date()
    ) {
      return invalidCodeResponse('Discount code is not yet active');
    }

    if (
      discountCode.expires_at &&
      new Date(discountCode.expires_at) < new Date()
    ) {
      return invalidCodeResponse('Discount code has expired');
    }

    if (
      discountCode.usage_limit != null &&
      discountCode.usage_count >= discountCode.usage_limit
    ) {
      return invalidCodeResponse('Discount code usage limit reached');
    }

    if (
      discountCode.minimum_purchase_amount != null &&
      cart_total < Number(discountCode.minimum_purchase_amount)
    ) {
      return invalidCodeResponse(
        `Minimum purchase of ₦${Number(discountCode.minimum_purchase_amount).toLocaleString()} required`
      );
    }

    const discountAmount = computeDiscountAmountForSubtotal(
      {
        discount_type:
          discountCode.discount_type === 'fixed_amount'
            ? 'fixed'
            : 'percentage',
        discount_value: Number(discountCode.discount_value),
        maximum_discount_amount:
          discountCode.maximum_discount_amount != null
            ? Number(discountCode.maximum_discount_amount)
            : null,
      },
      cart_total
    );

    return NextResponse.json({
      valid: true,
      discount_code_id: discountCode.id,
      code: discountCode.code,
      discount_type:
        discountCode.discount_type === 'fixed_amount' ? 'fixed' : 'percentage',
      discount_value: Number(discountCode.discount_value),
      discount_amount: discountAmount,
      minimum_order: discountCode.minimum_purchase_amount
        ? Number(discountCode.minimum_purchase_amount)
        : undefined,
      description: discountCode.description,
    });
  } catch (error) {
    logger.error({
      message: 'Error validating discount code',
      error: error instanceof Error ? error : 'Unknown error',
    });
    return NextResponse.json(
      { valid: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

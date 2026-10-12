import { type NextRequest, NextResponse } from 'next/server';
import { computeDiscountAmountForSubtotal } from '@/lib/checkout/discount-amount';
import { isLoyaltyCodeCurrencyCurrent } from '@/lib/checkout/is-loyalty-code-currency-current';
import { logger } from '@/lib/logger';
import { formatMerchantCurrency } from '@/lib/resolve-merchant-currency';
import { createAnonClient } from '@/lib/supabase/anon';
import {
  loyaltyCheckoutCodeRowSchema,
  storefrontDiscountCodeRowSchema,
  storefrontDiscountValidateSchema,
} from '@/schemas/storefront-discount';
import { lookupErrorResponse } from './lookup-error-response';

/**
 * POST /api/storefront/discount/validate
 * Validates a discount code for storefront customers via the anon
 * client and a SECURITY DEFINER RPC. CSRF exemption: anonymous
 * checkout visitors lack tokens; proxy rate limiting and the RPC's
 * read-only behavior mitigate abuse.
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

    // Errors are retryable 500s: fall-through would mislabel RDM-* codes.
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
      return NextResponse.json(
        { valid: false, error: 'Invalid discount code' },
        { status: 200 }
      );
    }
    const discountCode = parsedArray.success
      ? (parsedArray.data[0] ?? null)
      : (parsedSingle?.data ?? null);

    // Loyalty fallback (issue #3165): RDM-* codes live in
    // reward_redemptions, which the merchant-code lookup never reads.
    // Only attempted when that lookup found nothing (errors 500 above).
    if (!discountCode) {
      const { data: loyaltyData, error: loyaltyError } = await supabase.rpc(
        'get_loyalty_redemption_for_checkout',
        {
          p_merchant_id: merchant_id,
          p_code: code,
        }
      );
      // A failed lookup is a retryable server failure, not invalid.
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
      // Bridgeable shape only: discount types (plain 'discount' is
      // fixed by convention, mirroring the order wrapper) + positive
      // value. Other types fall through to the generic invalid.
      if (
        loyaltyCode != null &&
        (loyaltyCode.reward_type === 'discount' ||
          loyaltyCode.reward_type === 'discount_fixed' ||
          loyaltyCode.reward_type === 'discount_percentage') &&
        Number.isFinite(loyaltyValue) &&
        loyaltyValue > 0
      ) {
        // Dead codes collapse to the generic invalid an unknown code
        // gets (no probing oracle); the order wrapper re-enforces
        // state. Snapshot-governed: disabling a reward voids nothing.
        if (
          loyaltyCode.used ||
          (loyaltyCode.expires_at &&
            new Date(loyaltyCode.expires_at) < new Date())
        ) {
          return NextResponse.json(
            { valid: false, error: 'Invalid discount code' },
            { status: 200 }
          );
        }
        // Accepted oracle (low): the minimum message stays distinct
        // (public catalog info, actionable, rate-limit bounded); the
        // order wrapper re-enforces state authoritatively.
        if (
          loyaltyCode.minimum_order_amount != null &&
          cart_total < Number(loyaltyCode.minimum_order_amount)
        ) {
          // Merchant currency for the threshold label. A failed
          // lookup stays currency-neutral (no mislabeled threshold).
          const { data: merchantRow, error: merchantError } = await supabase
            .from('merchants')
            .select('country, payout_currency')
            .eq('id', merchant_id)
            .maybeSingle();
          const minimumAmount = Number(loyaltyCode.minimum_order_amount);
          const minimumLabel = merchantError
            ? minimumAmount.toLocaleString()
            : formatMerchantCurrency(
                minimumAmount,
                {
                  country: merchantRow?.country ?? null,
                  payout_currency: merchantRow?.payout_currency ?? null,
                },
                { maximumFractionDigits: 0 }
              );
          return NextResponse.json(
            {
              valid: false,
              error: `Minimum purchase of ${minimumLabel} required`,
            },
            { status: 200 }
          );
        }
        // Fixed codes keep their issuance currency (generic-invalid
        // collapse; the order wrapper enforces for real).
        if (
          loyaltyCode.reward_type !== 'discount_percentage' &&
          loyaltyCode.issuance_currency &&
          !(await isLoyaltyCodeCurrencyCurrent(
            supabase,
            merchant_id,
            loyaltyCode.issuance_currency
          ))
        ) {
          return NextResponse.json(
            { valid: false, error: 'Invalid discount code' },
            { status: 200 }
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
            maximum_discount_amount: null,
          },
          cart_total
        );
        // Explicit null: no discount_codes row exists for loyalty codes.
        return NextResponse.json({
          valid: true,
          discount_code_id: null,
          code,
          discount_type: loyaltyDiscountType,
          discount_value: loyaltyValue,
          discount_amount: loyaltyDiscountAmount,
          minimum_order: loyaltyCode.minimum_order_amount
            ? Number(loyaltyCode.minimum_order_amount)
            : undefined,
          description: loyaltyCode.reward_name,
        });
      }
    }

    if (!discountCode) {
      return NextResponse.json(
        { valid: false, error: 'Invalid discount code' },
        { status: 200 }
      );
    }

    // Check if code has started
    if (
      discountCode.starts_at &&
      new Date(discountCode.starts_at) > new Date()
    ) {
      return NextResponse.json(
        { valid: false, error: 'Discount code is not yet active' },
        { status: 200 }
      );
    }

    // Check if code has expired
    if (
      discountCode.expires_at &&
      new Date(discountCode.expires_at) < new Date()
    ) {
      return NextResponse.json(
        { valid: false, error: 'Discount code has expired' },
        { status: 200 }
      );
    }

    // Check usage limit
    if (
      discountCode.usage_limit != null &&
      discountCode.usage_count >= discountCode.usage_limit
    ) {
      return NextResponse.json(
        { valid: false, error: 'Discount code usage limit reached' },
        { status: 200 }
      );
    }

    // Check minimum purchase amount
    if (
      discountCode.minimum_purchase_amount != null &&
      cart_total < Number(discountCode.minimum_purchase_amount)
    ) {
      return NextResponse.json(
        {
          valid: false,
          error: `Minimum purchase of ₦${Number(discountCode.minimum_purchase_amount).toLocaleString()} required`,
        },
        { status: 200 }
      );
    }

    // Single source of truth for the amount (mirrored by the redemption RPC),
    // so caps and rounding stay aligned with the order route and the DB.
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

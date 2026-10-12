import { type NextRequest, NextResponse } from 'next/server';
import { computeDiscountAmountForSubtotal } from '@/lib/checkout/discount-amount';
import { logger } from '@/lib/logger';
import { formatMerchantCurrency } from '@/lib/resolve-merchant-currency';
import { createAnonClient } from '@/lib/supabase/anon';
import {
  loyaltyCheckoutCodeRowSchema,
  storefrontDiscountCodeRowSchema,
  storefrontDiscountValidateSchema,
} from '@/schemas/storefront-discount';

/**
 * POST /api/storefront/discount/validate
 * Validates a discount code for storefront customers.
 * Uses anon client with a SECURITY DEFINER RPC for anonymous access.
 *
 * CSRF exemption: Called by anonymous storefront visitors during checkout.
 * Guest users do not have CSRF tokens. Abuse is mitigated by rate limiting
 * in proxy.ts and the RPC's read-only validation behavior.
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
    // reward_redemptions, which the merchant-code lookup never reads. Only
    // attempted when the merchant lookup succeeded but found nothing — a
    // lookup error keeps the existing invalid response below. State-
    // distinguishing responses (used/expired/disabled) are intentional
    // and match the merchant-code branch below; the 12-hex code space
    // plus proxy rate limiting bound the probing oracle, and the order
    // wrapper re-enforces every state authoritatively.
    if (!error && !discountCode) {
      const { data: loyaltyData, error: loyaltyError } = await supabase.rpc(
        'get_loyalty_redemption_for_checkout',
        {
          p_merchant_id: merchant_id,
          p_code: code,
        }
      );
      // A failed lookup is a retryable server failure, not an invalid
      // code (mirrors the order-path resolver): valid-code holders must
      // not be told their issued code is invalid during an outage.
      if (loyaltyError) {
        logger.error({
          message: 'Loyalty code lookup failed',
          error: loyaltyError,
          merchantId: merchant_id,
        });
        return NextResponse.json(
          { valid: false, error: 'Internal server error' },
          { status: 500 }
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
      // value. Other reward types fall through to the generic invalid
      // response — they are honored through manual/fulfillment
      // channels.
      if (
        loyaltyCode != null &&
        (loyaltyCode.reward_type === 'discount' ||
          loyaltyCode.reward_type === 'discount_fixed' ||
          loyaltyCode.reward_type === 'discount_percentage') &&
        Number.isFinite(loyaltyValue) &&
        loyaltyValue > 0
      ) {
        // Dead codes collapse to the same generic invalid an unknown
        // code gets: distinct used/expired messages would let anyone
        // probe live codes without spending. The order wrapper
        // re-enforces state and keeps the authoritative distinction.
        // Snapshot-governed: a disabled reward no longer voids its
        // issued codes (the resolver selects no live reward state).
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
        // Accepted oracle (low): unlike the collapsed dead-code states
        // above, the minimum message stays distinct. It discloses that a
        // probed code is live, but the minimum itself is public catalog
        // info, the message is actionable ("add more to unlock"), the
        // 12-hex space plus proxy rate limiting bounds enumeration, and
        // the order wrapper re-enforces state authoritatively.
        if (
          loyaltyCode.minimum_order_amount != null &&
          cart_total < Number(loyaltyCode.minimum_order_amount)
        ) {
          // Merchant currency for the threshold label (anon-granted
          // published columns). A failed lookup stays currency-neutral
          // instead of mislabeling a non-NGN threshold as NGN; only a
          // cleanly absent row falls back to the NGN default.
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
        // Explicit null (not absent): no discount_codes row exists for a
        // loyalty code, and the order route re-resolves server-side.
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

    if (error || !discountCode) {
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

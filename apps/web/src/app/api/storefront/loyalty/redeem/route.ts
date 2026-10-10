import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { toCatalogReward } from '@/lib/loyalty-reward-catalog';
import { formatMerchantCurrency } from '@/lib/resolve-merchant-currency';
import { createClient } from '@/lib/supabase/server';
import {
  type StorefrontLoyaltyRedeemResult,
  storefrontLoyaltyRedeemResultSchema,
  storefrontLoyaltyRedeemSchema,
} from '@/schemas/storefront-loyalty-redeem';

type RedeemRpcResult = {
  success: boolean;
  error?: string;
  required?: number;
  available?: number;
  points_cost?: number;
} & Partial<StorefrontLoyaltyRedeemResult>;

const RPC_ERROR_STATUS: Record<string, number> = {
  program_unavailable: 404,
  customer_not_found: 404,
  not_enrolled: 404,
  reward_unavailable: 404,
  insufficient_points: 400,
  minimum_not_met: 400,
  usage_limit_reached: 409,
  invalid_input: 400,
};

const RPC_ERROR_MESSAGE: Record<string, string> = {
  program_unavailable: 'Loyalty program not available for this merchant',
  customer_not_found: 'Customer not found for this merchant',
  not_enrolled: 'Customer is not enrolled in the loyalty program',
  reward_unavailable: 'Reward not found or no longer available',
  insufficient_points: 'Insufficient points',
  minimum_not_met: 'Minimum redemption amount not met',
  usage_limit_reached: 'Redemption limit reached for this reward',
  invalid_input: 'Invalid redemption input',
};

function getRedemptionInstructions(
  reward: {
    reward_type: string;
    discount_type?: string;
    discount_value?: number;
  },
  merchantCurrency: { country?: string | null; payout_currency?: string | null }
): string {
  switch (reward.reward_type) {
    case 'discount':
      // Plain discounts without a positive value stay redeemable (the
      // RPC's valued guard covers only the valued types), so render a
      // generic label instead of "undefined"/zero off.
      if (reward.discount_value == null || reward.discount_value <= 0) {
        return 'Apply this code at checkout to receive your discount.';
      }
      if (reward.discount_type === 'percentage') {
        return `Apply this code at checkout to receive ${reward.discount_value}% off your order.`;
      }
      // Same formatter as the rewards catalog: fixed-value labels render
      // in the merchant's own payout currency (NGN fallback matches the
      // previous hardcoded symbol when the merchant row is unreadable).
      return `Apply this code at checkout to receive ${formatMerchantCurrency(
        reward.discount_value ?? 0,
        {
          country: merchantCurrency.country ?? null,
          payout_currency: merchantCurrency.payout_currency ?? null,
        },
        { maximumFractionDigits: 0 }
      )} off your order.`;
    case 'free_shipping':
      return 'Apply this code at checkout to receive free shipping on your order.';
    case 'free_product':
      return 'Present this code to claim your free product. Contact the store for details.';
    case 'exclusive_access':
      return 'This code grants you early access to new products and exclusive sales.';
    case 'store_credit':
      return 'The credit has been added to your store balance and applies automatically at checkout.';
    default:
      return 'Apply this code at checkout or present it in-store to redeem your reward.';
  }
}

// POST - Redeem a reward.
//
// The caller must own the customer row; the redeem_loyalty_reward RPC
// re-verifies ownership and performs availability, balance, redemption,
// deduction, and ledger writes atomically (the loyalty tables are
// merchant-only under RLS, so the route cannot read them directly).
// The response shape is kept stable for the use-loyalty.ts redeem caller.
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Cookie-authenticated browsers: reject forged cross-site POSTs before
    // the points-spending redemption RPC runs (AGENTS.md CSRF rule).
    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = storefrontLoyaltyRedeemSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'merchant_id, customer_id, and reward_id are required' },
        { status: 400 }
      );
    }

    // Resolve the caller's own live customer row for this merchant.
    // A mismatch returns the same 404 as a missing customer so callers
    // cannot probe which customer IDs exist. Soft-deleted rows are
    // non-writable.
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('merchant_id', parsed.data.merchant_id)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (customerError) {
      logger.error({
        message: 'Error resolving redemption customer',
        error: customerError,
      });
      return NextResponse.json(
        { error: 'Failed to process redemption' },
        { status: 500 }
      );
    }

    // No guest re-link hint here (unlike enroll): redemption requires
    // enrollment first, so an unlinked guest is correctly not-found
    // until they enroll, where the hint fires.
    if (!customer || customer.id !== parsed.data.customer_id) {
      return NextResponse.json(
        { error: 'Customer not found for this merchant' },
        { status: 404 }
      );
    }

    const { data, error } = await supabase.rpc('redeem_loyalty_reward', {
      p_merchant_id: parsed.data.merchant_id,
      p_customer_id: parsed.data.customer_id,
      p_reward_id: parsed.data.reward_id,
    });

    if (error) {
      logger.error({
        message: 'Error processing redemption',
        error,
      });
      return NextResponse.json(
        { error: 'Failed to process redemption' },
        { status: 500 }
      );
    }

    const result = data as RedeemRpcResult | null;
    if (!result?.success) {
      const code = result?.error ?? 'redeem_failed';
      const status = RPC_ERROR_STATUS[code] ?? 500;
      if (status === 500) {
        logger.error({
          message: 'Unexpected redemption result',
          error: { code, result },
        });
      }
      if (code === 'insufficient_points' || code === 'minimum_not_met') {
        return NextResponse.json(
          {
            error: RPC_ERROR_MESSAGE[code],
            required: result?.required,
            available: result?.available,
            ...(code === 'minimum_not_met'
              ? { points_cost: result?.points_cost }
              : {}),
          },
          { status }
        );
      }
      return NextResponse.json(
        { error: RPC_ERROR_MESSAGE[code] ?? 'Failed to process redemption' },
        { status }
      );
    }

    const validated = storefrontLoyaltyRedeemResultSchema.safeParse(result);
    if (!validated.success) {
      logger.error({
        message: 'Malformed redemption result',
        error: { result },
      });
      return NextResponse.json(
        { error: 'Failed to process redemption' },
        { status: 500 }
      );
    }

    const redemption = validated.data;
    const catalog = toCatalogReward({
      id: parsed.data.reward_id,
      name: redemption.reward_name,
      description: null,
      points_cost: redemption.points_spent,
      reward_type: redemption.reward_type,
      reward_value: redemption.reward_value,
    });

    // Merchant currency for fixed-value instruction labels (country and
    // payout_currency are anon-granted published columns, so this read
    // is safe under RLS; failures fall back to the NGN default below).
    const { data: merchantRow } = await supabase
      .from('merchants')
      .select('country, payout_currency')
      .eq('id', parsed.data.merchant_id)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      message: 'Reward redeemed successfully',
      data: {
        redemption_code: redemption.redemption_code,
        reward_name: redemption.reward_name,
        reward_type: catalog.reward_type,
        discount_value: redemption.reward_value ?? undefined,
        discount_type: catalog.discount_type,
        points_spent: redemption.points_spent,
        new_balance: redemption.new_balance,
        expires_at: redemption.expires_at,
        instructions: getRedemptionInstructions(
          {
            reward_type: catalog.reward_type,
            discount_type: catalog.discount_type,
            discount_value: redemption.reward_value ?? undefined,
          },
          merchantRow ?? {}
        ),
      },
    });
  } catch (error) {
    logger.error({ message: 'Error in reward redemption', error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import {
  type StorefrontLoyaltyStatusResult,
  storefrontLoyaltyStatusQuerySchema,
  storefrontLoyaltyStatusResultSchema,
} from '@/schemas/storefront-loyalty-status';

type LoyaltyStatusRpcResult = {
  success: boolean;
  error?: string;
} & Partial<StorefrontLoyaltyStatusResult>;

const RPC_ERROR_STATUS: Record<string, number> = {
  program_unavailable: 404,
  customer_not_found: 404,
  forbidden: 403,
  invalid_input: 400,
};

const RPC_ERROR_MESSAGE: Record<string, string> = {
  program_unavailable: 'Loyalty program not available for this merchant',
  customer_not_found: 'Customer not found for this merchant',
  forbidden: 'You can only view your own loyalty status',
  invalid_input: 'Invalid loyalty status input',
};

const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum'] as const;
type TierName = (typeof TIER_ORDER)[number];

const DEFAULT_THRESHOLDS: Record<TierName, number> = {
  bronze: 0,
  silver: 1000,
  gold: 5000,
  platinum: 10000,
};

function toTierName(value: string): TierName {
  const lowered = value.toLowerCase();
  return (TIER_ORDER as readonly string[]).includes(lowered)
    ? (lowered as TierName)
    : 'bronze';
}

// GET - Get customer's loyalty status.
//
// Reads through the get_loyalty_status RPC: the caller must own the
// customer row, and the projection comes from the real schema (tiers JSONB,
// points_cost/enabled rewards). The response shape is kept stable for the
// use-loyalty.ts caller.
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const parsed = storefrontLoyaltyStatusQuerySchema.safeParse({
      merchant_id: searchParams.get('merchant_id'),
      customer_id: searchParams.get('customer_id'),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'merchant_id and customer_id are required' },
        { status: 400 }
      );
    }

    // Resolve the caller's own customer row for this merchant. A mismatch
    // returns the same 404 as a missing customer so callers cannot probe
    // which customer IDs exist.
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('merchant_id', parsed.data.merchant_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (customerError) {
      logger.error({
        message: 'Error resolving loyalty status customer',
        error: customerError,
      });
      return NextResponse.json(
        { error: 'Failed to fetch loyalty data' },
        { status: 500 }
      );
    }

    if (!customer || customer.id !== parsed.data.customer_id) {
      return NextResponse.json(
        { error: 'Customer not found for this merchant' },
        { status: 404 }
      );
    }

    const { data, error } = await supabase.rpc('get_loyalty_status', {
      p_merchant_id: parsed.data.merchant_id,
      p_customer_id: parsed.data.customer_id,
    });

    if (error) {
      logger.error({
        message: 'Error fetching loyalty status',
        error,
      });
      return NextResponse.json(
        { error: 'Failed to fetch loyalty data' },
        { status: 500 }
      );
    }

    const result = data as LoyaltyStatusRpcResult | null;
    if (!result?.success) {
      const code = result?.error ?? 'status_failed';
      const status = RPC_ERROR_STATUS[code] ?? 500;
      if (status === 500) {
        logger.error({
          message: 'Unexpected loyalty status result',
          error: { code, result },
        });
      }
      return NextResponse.json(
        { error: RPC_ERROR_MESSAGE[code] ?? 'Failed to fetch loyalty data' },
        { status }
      );
    }

    const validated = storefrontLoyaltyStatusResultSchema.safeParse(result);
    if (!validated.success) {
      logger.error({
        message: 'Malformed loyalty status result',
        error: { result },
      });
      return NextResponse.json(
        { error: 'Failed to fetch loyalty data' },
        { status: 500 }
      );
    }

    const status = validated.data;
    // Pass the merchant-defined tier name through (lowercased): the hook
    // falls back to bronze styling for names outside the standard four.
    const tier = status.current_tier.toLowerCase();
    const thresholds: Record<TierName, number> = { ...DEFAULT_THRESHOLDS };
    for (const entry of status.tiers) {
      const name = toTierName(entry.name);
      if (entry.name.toLowerCase() === name) {
        thresholds[name] = entry.minPoints;
      }
    }

    let nextTier: TierName | null = null;
    for (const name of TIER_ORDER) {
      if (thresholds[name] > status.lifetime_points) {
        nextTier = name;
        break;
      }
    }
    const pointsToNextTier = nextTier
      ? Math.max(0, thresholds[nextTier] - status.lifetime_points)
      : 0;

    const perCurrency = status.points_per_currency ?? 1;
    const currencyUnit = status.points_currency_unit ?? 100;
    const availableRewards = status.rewards.map((reward) => ({
      id: reward.id,
      name: reward.name,
      description: reward.description ?? '',
      points_required: reward.points_cost,
      reward_type: reward.reward_type,
      discount_value: reward.reward_value ?? undefined,
      active: true,
    }));
    const redeemableRewards = availableRewards.filter(
      (reward) => reward.points_required <= status.points_balance
    );

    return NextResponse.json({
      enrolled: status.enrolled,
      points_balance: status.points_balance,
      lifetime_points: status.lifetime_points,
      tier,
      next_tier: nextTier,
      points_to_next_tier: pointsToNextTier,
      tier_thresholds: thresholds,
      available_rewards: availableRewards,
      redeemable_rewards: redeemableRewards,
      recent_transactions: status.transactions.map((txn) => ({
        id: txn.id,
        points: txn.points,
        type: txn.type,
        description: txn.description ?? '',
        created_at: txn.created_at,
      })),
      settings: {
        points_per_naira: currencyUnit > 0 ? perCurrency / currencyUnit : 0.01,
        naira_per_point: perCurrency > 0 ? currencyUnit / perCurrency : 100,
        welcome_bonus: status.signup_bonus_points,
        referral_bonus_referrer: status.referral_bonus_points,
        referral_bonus_referee: status.referral_bonus_points,
      },
    });
  } catch (error) {
    logger.error({ message: 'Error in loyalty status', error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

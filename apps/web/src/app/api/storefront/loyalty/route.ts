import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { toCatalogReward } from '@/lib/loyalty-reward-catalog';
import {
  dedupeLadderByName,
  toLadderMultiplier,
  toLadderThreshold,
} from '@/lib/loyalty-tier-threshold';
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
  invalid_input: 400,
};

const RPC_ERROR_MESSAGE: Record<string, string> = {
  program_unavailable: 'Loyalty program not available for this merchant',
  customer_not_found: 'Customer not found for this merchant',
  invalid_input: 'Invalid loyalty status input',
};
const DEFAULT_THRESHOLDS: Record<string, number> = {
  bronze: 0,
  silver: 1000,
  gold: 5000,
  platinum: 10000,
};

// GET - Get customer's loyalty status through get_loyalty_status (caller
// must own the row). The response shape is kept stable for use-loyalty.ts.
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

    // Resolve the caller's own live customer row: mismatches return
    // the same 404 as missing rows (no ID probing). Guests are
    // not-enrolled until they enroll, where the re-link hint fires.
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('merchant_id', parsed.data.merchant_id)
      .eq('user_id', user.id)
      .is('deleted_at', null)
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

    // Normalize merchant-saved tiers before validation: arbitrary tier
    // JSON can carry null entries/thresholds (which would 500 below).
    // toLadderThreshold coerces digit-strings like calculate_loyalty_tier;
    // unusable thresholds drop the rung (SQL never matches them — a 0
    // floor would invent a rung and hide the real threshold on dedupe).
    // Nameless entries drop too (SQL assignment skips them).
    type RawTierEntry = {
      name?: unknown;
      minPoints?: unknown;
      multiplier?: unknown;
      perks?: unknown;
    };
    const candidates: unknown[] = Array.isArray(result.tiers)
      ? result.tiers
      : [];
    const rawTiers: RawTierEntry[] = candidates.filter(
      (entry): entry is RawTierEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as RawTierEntry).name === 'string' &&
        ((entry as RawTierEntry).name as string).trim() !== ''
    );
    const normalizedResult = {
      ...result,
      tiers: rawTiers.flatMap((entry) => {
        const minPoints = toLadderThreshold(entry.minPoints);
        if (minPoints === null) return [];
        return [
          {
            ...entry,
            name: typeof entry.name === 'string' ? entry.name : '',
            minPoints,
            // Numeric strings coerce like award_purchase_points'
            // text-extraction grammar; anything else stays null.
            multiplier: toLadderMultiplier(entry.multiplier),
            perks: Array.isArray(entry.perks)
              ? entry.perks.filter(
                  (perk): perk is string => typeof perk === 'string'
                )
              : [],
          },
        ];
      }),
    };
    const validated =
      storefrontLoyaltyStatusResultSchema.safeParse(normalizedResult);
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

    // Progress along the deduped merchant ladder (same tiers SQL uses);
    // search after the member's rung, lifetime-only for unknown names.
    const ladder = dedupeLadderByName(
      [...status.tiers]
        .map((entry) => ({
          name: entry.name.toLowerCase(),
          minPoints: entry.minPoints,
          multiplier: entry.multiplier ?? null,
          perks: entry.perks ?? [],
        }))
        .sort((a, b) => a.minPoints - b.minPoints)
    );
    const currentPosition = ladder.findIndex((entry) => entry.name === tier);
    const rungsAhead =
      currentPosition >= 0 ? ladder.slice(currentPosition + 1) : ladder;
    const nextEntry = rungsAhead.find(
      (entry) => entry.minPoints > status.lifetime_points
    );
    const nextTier = nextEntry ? nextEntry.name : null;
    const pointsToNextTier = nextEntry
      ? Math.max(0, nextEntry.minPoints - status.lifetime_points)
      : 0;
    // Thresholds cover the whole ladder over the defaults, so every rung
    // resolves. Progress is computed here: lifetime can sit below a raised
    // threshold, which the card's subtraction turns negative or NaN.
    const thresholds: Record<string, number> = { ...DEFAULT_THRESHOLDS };
    for (const entry of ladder) {
      thresholds[entry.name] = entry.minPoints;
    }
    const currentFloor =
      currentPosition >= 0 ? (ladder[currentPosition]?.minPoints ?? 0) : 0;
    let tierProgress: number;
    if (!nextEntry) {
      tierProgress = 100;
    } else if (nextEntry.minPoints <= currentFloor) {
      tierProgress = status.lifetime_points >= nextEntry.minPoints ? 100 : 0;
    } else {
      tierProgress = Math.min(
        100,
        Math.max(
          0,
          ((status.lifetime_points - currentFloor) /
            (nextEntry.minPoints - currentFloor)) *
            100
        )
      );
    }

    const perCurrency = status.points_per_currency ?? 1;
    const currencyUnit = status.points_currency_unit ?? 100;
    const availableRewards = status.rewards.map((reward) => {
      const catalog = toCatalogReward(reward);
      return {
        id: reward.id,
        name: reward.name,
        description: reward.description ?? '',
        points_required: reward.points_cost,
        reward_type: catalog.reward_type,
        discount_type: catalog.discount_type,
        discount_value: reward.reward_value ?? undefined,
        // Catalog discloses the checkout minimum before points are spent.
        minimum_order_amount: reward.minimum_order_amount ?? undefined,
        active: true,
      };
    });
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
      tier_progress: tierProgress,
      tiers: ladder,
      referral_code: status.referral_code,
      available_rewards: availableRewards,
      redeemable_rewards: redeemableRewards,
      recent_transactions: status.transactions.map((txn) => ({
        id: txn.id,
        points: txn.points,
        type: txn.type,
        description: txn.description ?? '',
        created_at: txn.created_at,
        redemption_code: txn.redemption_code ?? null,
      })),
      settings: {
        points_per_naira: currencyUnit > 0 ? perCurrency / currencyUnit : 0.01,
        naira_per_point: perCurrency > 0 ? currencyUnit / perCurrency : 100,
        // Clamp like the enrollment RPC so the form never advertises negatives.
        welcome_bonus: Math.max(0, status.signup_bonus_points),
        referral_bonus_referrer: Math.max(0, status.referral_bonus_points),
        referral_bonus_referee: Math.max(0, status.referral_bonus_points),
        max_redemption_percentage: status.max_redemption_percentage ?? null,
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

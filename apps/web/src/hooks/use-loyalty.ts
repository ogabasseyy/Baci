'use client';
import { useEffect, useRef, useState } from 'react';
import { buildCsrfHeaders } from '@/lib/csrf';
import { type LoyaltyData, loadLoyaltyData } from '@/lib/loyalty-data-client';
import { redemptionIdempotencyKeys } from '@/lib/loyalty-redemption-keys';

interface RedemptionResult {
  success: boolean;
  redemption_code?: string;
  reward_name?: string;
  reward_type?: string;
  discount_value?: number;
  points_spent?: number;
  new_balance?: number;
  expires_at?: string;
  instructions?: string;
  error?: string;
}

interface EnrollmentResult {
  success: boolean;
  points_balance?: number;
  tier?: string;
  referral_code?: string;
  error?: string;
}
const PERK_LABELS: Record<string, string> = {
  free_shipping: 'Free shipping',
  early_access: 'Early access to sales',
  exclusive_discounts: 'Exclusive discounts',
};

function humanizePerk(perk: string): string {
  const words = perk.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export function useLoyalty(merchantId?: string, customerId?: string) {
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // One in-flight load per instance: a refetch (or identity change)
  // aborts the previous request so a slow first response cannot
  // overwrite fresher data or clear its loading state.
  const controllerRef = useRef<AbortController | null>(null);
  // A post-mutation refresh runs only while the mutation's identity is
  // still current, so a slow enroll/redeem cannot abort the new load.
  const identityRef = useRef({ merchantId, customerId });
  const fetchLoyaltyData = () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return loadLoyaltyData(
      merchantId,
      customerId,
      { setData, setLoading, setError },
      controller.signal
    );
  };

  useEffect(() => {
    identityRef.current = { merchantId, customerId };
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    void loadLoyaltyData(
      merchantId,
      customerId,
      { setData, setLoading, setError },
      controller.signal
    );
    return () => controller.abort();
  }, [merchantId, customerId]);

  const enroll = async (referralCode?: string): Promise<EnrollmentResult> => {
    if (!merchantId || !customerId) {
      return { success: false, error: 'Missing merchant or customer ID' };
    }

    try {
      const response = await fetch('/api/storefront/loyalty/enroll', {
        method: 'POST',
        headers: buildCsrfHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          merchant_id: merchantId,
          customer_id: customerId,
          referral_code: referralCode,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        return { success: false, error: result.error };
      }

      // Refresh loyalty data after enrollment (skipped if superseded)
      if (
        identityRef.current.merchantId === merchantId &&
        identityRef.current.customerId === customerId
      ) {
        await fetchLoyaltyData();
      }

      return {
        success: true,
        points_balance: result.data.points_balance,
        tier: result.data.tier,
        referral_code: result.data.referral_code,
      };
    } catch (err) {
      console.error('Error enrolling in loyalty program:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to enroll',
      };
    }
  };

  const redeemReward = async (rewardId: string): Promise<RedemptionResult> => {
    if (!merchantId || !customerId) {
      return { success: false, error: 'Missing merchant or customer ID' };
    }

    // Stable per-reward key: a timeout retry reuses the failed
    // attempt's key so the RPC replays instead of re-spending. The key
    // clears only on success (a 4xx validation failure keeps it: fixing
    // the cause and retrying replays nothing since failures never store).
    const idempotencyKey = await redemptionIdempotencyKeys.forReward(
      merchantId,
      customerId,
      rewardId
    );

    try {
      const response = await fetch('/api/storefront/loyalty/redeem', {
        method: 'POST',
        headers: buildCsrfHeaders({
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        }),
        body: JSON.stringify({
          merchant_id: merchantId,
          customer_id: customerId,
          reward_id: rewardId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        return { success: false, error: result.error };
      }

      redemptionIdempotencyKeys.clearForReward(
        merchantId,
        customerId,
        rewardId
      );

      // Refresh loyalty data after redemption (skipped if superseded)
      if (
        identityRef.current.merchantId === merchantId &&
        identityRef.current.customerId === customerId
      ) {
        await fetchLoyaltyData();
      }

      return {
        success: true,
        redemption_code: result.data.redemption_code,
        reward_name: result.data.reward_name,
        reward_type: result.data.reward_type,
        discount_value: result.data.discount_value,
        points_spent: result.data.points_spent,
        new_balance: result.data.new_balance,
        expires_at: result.data.expires_at,
        instructions: result.data.instructions,
      };
    } catch (err) {
      console.error('Error redeeming reward:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to redeem reward',
      };
    }
  };

  // Helper to calculate points from purchase amount
  const calculatePoints = (amount: number): number => {
    if (!data?.settings.points_per_naira) return 0;
    return Math.floor(amount * data.settings.points_per_naira);
  };

  // Helper to calculate point value in naira
  const calculatePointValue = (points: number): number => {
    if (!data?.settings.naira_per_point) return 0;
    return points * data.settings.naira_per_point;
  };

  // Get tier display info
  const getTierInfo = (tier: string) => {
    const tierColors = {
      bronze: {
        bg: 'bg-amber-100',
        text: 'text-amber-800',
        border: 'border-amber-300',
      },
      silver: {
        bg: 'bg-gray-100',
        text: 'text-gray-800',
        border: 'border-gray-300',
      },
      gold: {
        bg: 'bg-yellow-100',
        text: 'text-yellow-800',
        border: 'border-yellow-400',
      },
      platinum: {
        bg: 'bg-purple-100',
        text: 'text-purple-800',
        border: 'border-purple-400',
      },
    };

    // Fallback when the status payload predates the tiers contract (older
    // cached responses) or the merchant never configured this rung: the
    // live path below renders merchant-defined values instead.
    const tierBenefits = {
      bronze: ['Earn 1 point per ₦100 spent', 'Access to basic rewards'],
      silver: [
        'Earn 1.5x points',
        'Early access to sales',
        'Free shipping on orders over ₦20,000',
      ],
      gold: [
        'Earn 2x points',
        'Priority customer support',
        'Exclusive discounts',
        'Free shipping',
      ],
      platinum: [
        'Earn 3x points',
        'VIP support',
        'Exclusive products',
        'Free express shipping',
      ],
    };

    // Merchant-defined benefits first: the persisted ladder's multiplier
    // (1.25x Silver, 1.5x Gold, 2x Platinum by default) and perk codes
    // are the source of truth, not the hardcoded claims above.
    const merchantTier = data?.tiers?.find(
      (entry) => entry.name.toLowerCase() === tier.toLowerCase()
    );
    if (merchantTier) {
      const benefits: string[] = [];
      if (merchantTier.multiplier != null) {
        benefits.push(`Earn ${merchantTier.multiplier}x points`);
      }
      for (const perk of merchantTier.perks ?? []) {
        benefits.push(PERK_LABELS[perk] ?? humanizePerk(perk));
      }
      return {
        colors:
          tierColors[tier as keyof typeof tierColors] || tierColors.bronze,
        // Authoritative even when empty: a configured rung with no
        // multiplier/perks must not inherit hardcoded marketing copy.
        benefits,
      };
    }

    return {
      colors: tierColors[tier as keyof typeof tierColors] || tierColors.bronze,
      benefits:
        tierBenefits[tier as keyof typeof tierBenefits] || tierBenefits.bronze,
    };
  };

  return {
    data,
    loading,
    error,
    enrolled: data?.enrolled ?? false,
    pointsBalance: data?.points_balance ?? 0,
    tier: data?.tier ?? 'bronze',
    nextTier: data?.next_tier,
    pointsToNextTier: data?.points_to_next_tier ?? 0,
    maxRedemptionPercentage: data?.settings?.max_redemption_percentage ?? null,
    availableRewards: data?.available_rewards ?? [],
    redeemableRewards: data?.redeemable_rewards ?? [],
    recentTransactions: data?.recent_transactions ?? [],
    enroll,
    redeemReward,
    calculatePoints,
    calculatePointValue,
    getTierInfo,
    refetch: fetchLoyaltyData,
  };
}

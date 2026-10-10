'use client';

import { useEffect, useState } from 'react';
import { buildCsrfHeaders } from '@/lib/csrf';

interface LoyaltyReward {
  id: string;
  name: string;
  description: string;
  points_required: number;
  reward_type:
    | 'discount'
    | 'free_shipping'
    | 'free_product'
    | 'exclusive_access'
    | 'store_credit';
  discount_type?: 'percentage' | 'fixed';
  discount_value?: number;
  active: boolean;
}

interface PointsTransaction {
  id: string;
  points: number;
  type: 'purchase' | 'bonus' | 'referral' | 'redemption' | 'adjustment';
  description: string;
  created_at: string;
}

interface LoyaltySettings {
  points_per_naira: number;
  naira_per_point: number;
  welcome_bonus: number;
  referral_bonus_referrer: number;
  referral_bonus_referee: number;
}

interface LoyaltyTier {
  name: string;
  minPoints: number;
  multiplier: number | null;
  perks: string[];
}

interface LoyaltyData {
  enrolled: boolean;
  points_balance: number;
  lifetime_points: number;
  // Merchant-defined ladder names flow through lowercased (Starter, VIP,
  // ...), not just the default bronze/silver/gold/platinum rungs:
  // getTierInfo falls back to bronze styling for unknown names.
  tier: string;
  next_tier: string | null;
  points_to_next_tier: number;
  tier_thresholds: Record<string, number>;
  tier_progress: number;
  tiers: LoyaltyTier[];
  referral_code: string | null;
  available_rewards: LoyaltyReward[];
  redeemable_rewards: LoyaltyReward[];
  recent_transactions: PointsTransaction[];
  settings: LoyaltySettings;
}

interface RedemptionResult {
  success: boolean;
  redemption_code?: string;
  reward_name?: string;
  reward_type?: string;
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

interface LoyaltyStateHandlers {
  setData: (data: LoyaltyData | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
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

// Mock data for preview/demo merchants. Built fresh per call so consumers
// never share a mutable reference.
function buildPreviewLoyaltyData(): LoyaltyData {
  return {
    enrolled: true,
    points_balance: 150,
    lifetime_points: 500,
    tier: 'silver',
    next_tier: 'gold',
    points_to_next_tier: 350,
    tier_thresholds: {
      bronze: 0,
      silver: 100,
      gold: 500,
      platinum: 1000,
    },
    tier_progress: 55,
    tiers: [
      { name: 'bronze', minPoints: 0, multiplier: 1, perks: [] },
      {
        name: 'silver',
        minPoints: 100,
        multiplier: 1.25,
        perks: ['free_shipping'],
      },
      {
        name: 'gold',
        minPoints: 500,
        multiplier: 1.5,
        perks: ['free_shipping', 'early_access'],
      },
      {
        name: 'platinum',
        minPoints: 1000,
        multiplier: 2,
        perks: ['free_shipping', 'early_access', 'exclusive_discounts'],
      },
    ],
    referral_code: 'PREVIEW1',
    available_rewards: [],
    redeemable_rewards: [],
    recent_transactions: [],
    settings: {
      points_per_naira: 1,
      naira_per_point: 1,
      welcome_bonus: 50,
      referral_bonus_referrer: 50,
      referral_bonus_referee: 50,
    },
  };
}

// Module-scope helper so the try/finally + throw stay outside the hook body
// (React Compiler cannot lower try/finally inside components/hooks yet).
async function loadLoyaltyData(
  merchantId: string | undefined,
  customerId: string | undefined,
  { setData, setLoading, setError }: LoyaltyStateHandlers,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return;

  if (!merchantId || !customerId) {
    setData(null);
    setError(null);
    setLoading(false);
    return;
  }

  if (merchantId.endsWith('-preview') || merchantId.startsWith('demo-')) {
    setData(buildPreviewLoyaltyData());
    setError(null);
    setLoading(false);
    return;
  }

  try {
    setLoading(true);
    const params = new URLSearchParams({
      merchant_id: merchantId,
      customer_id: customerId,
    });

    const response = await fetch(`/api/storefront/loyalty?${params}`, {
      signal,
    });
    if (signal?.aborted) return;
    if (!response.ok) {
      if (response.status === 404) {
        // Loyalty program not available or customer not enrolled
        setData(null);
        setError(null);
        return;
      }
      throw new Error('Failed to fetch loyalty data');
    }

    const loyaltyData = await response.json();
    if (signal?.aborted) return;
    setData(loyaltyData);
    setError(null);
  } catch (err) {
    if (signal?.aborted) return;
    console.error('Error fetching loyalty data:', err);
    setError(err instanceof Error ? err.message : 'Unknown error');
    setData(null);
  } finally {
    if (!signal?.aborted) {
      setLoading(false);
    }
  }
}

export function useLoyalty(merchantId?: string, customerId?: string) {
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLoyaltyData = () =>
    loadLoyaltyData(merchantId, customerId, { setData, setLoading, setError });

  useEffect(() => {
    const controller = new AbortController();
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

      // Refresh loyalty data after enrollment
      await fetchLoyaltyData();

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

    try {
      const response = await fetch('/api/storefront/loyalty/redeem', {
        method: 'POST',
        headers: buildCsrfHeaders({ 'Content-Type': 'application/json' }),
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

      // Refresh loyalty data after redemption
      await fetchLoyaltyData();

      return {
        success: true,
        redemption_code: result.data.redemption_code,
        reward_name: result.data.reward_name,
        reward_type: result.data.reward_type,
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
        benefits:
          benefits.length > 0
            ? benefits
            : tierBenefits[tier as keyof typeof tierBenefits] ||
              tierBenefits.bronze,
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

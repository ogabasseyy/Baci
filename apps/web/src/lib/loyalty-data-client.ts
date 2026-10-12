// Loyalty status fetch + shapes for use-loyalty (split out: 300-line limit).
// Single primary export (loadLoyaltyData); the interfaces travel with it
// because no other module consumes them.

export interface LoyaltyReward {
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
  minimum_order_amount?: number;
  active: boolean;
}

export interface PointsTransaction {
  id: string;
  points: number;
  type: 'purchase' | 'bonus' | 'referral' | 'redemption' | 'adjustment';
  description: string;
  created_at: string;
}

export interface LoyaltySettings {
  points_per_naira: number;
  naira_per_point: number;
  welcome_bonus: number;
  referral_bonus_referrer: number;
  referral_bonus_referee: number;
}

export interface LoyaltyTier {
  name: string;
  minPoints: number;
  multiplier: number | null;
  perks: string[];
}

export interface LoyaltyData {
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

export interface LoyaltyStateHandlers {
  setData: (data: LoyaltyData | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
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
export async function loadLoyaltyData(
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

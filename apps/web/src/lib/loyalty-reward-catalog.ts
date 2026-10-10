export type CatalogRewardType =
  | 'discount'
  | 'free_shipping'
  | 'free_product'
  | 'exclusive_access'
  | 'store_credit';

export type PersistedReward = {
  id: string;
  name: string;
  description: string | null;
  points_cost: number;
  reward_type: string;
  reward_value: number | null;
};

export type CatalogRewardMapping = {
  reward_type: CatalogRewardType;
  discount_type: 'percentage' | 'fixed' | undefined;
};

const KNOWN_REWARD_TYPES: readonly CatalogRewardType[] = [
  'discount',
  'free_shipping',
  'free_product',
  'exclusive_access',
  // Fulfilled by redeem_loyalty_reward as a customers.store_credit credit,
  // not a discount code: keep it a distinct catalog type so the UI never
  // presents it as a checkout code.
  'store_credit',
];

// Normalize persisted reward types to the storefront catalog contract: the
// catalog indexes its icon map directly and crashes on unknown keys.
// Persisted `discount_percentage` / `discount_fixed` variants fold into
// `discount` with the matching discount_type; anything else unknown falls
// back to a plain discount so the reward stays renderable.
export function toCatalogReward(reward: PersistedReward): CatalogRewardMapping {
  if (reward.reward_type === 'discount_percentage') {
    return { reward_type: 'discount', discount_type: 'percentage' };
  }
  if (reward.reward_type === 'discount_fixed') {
    return { reward_type: 'discount', discount_type: 'fixed' };
  }
  if ((KNOWN_REWARD_TYPES as readonly string[]).includes(reward.reward_type)) {
    return {
      reward_type: reward.reward_type as CatalogRewardType,
      discount_type: undefined,
    };
  }
  return { reward_type: 'discount', discount_type: undefined };
}

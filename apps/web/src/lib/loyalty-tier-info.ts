import type { LoyaltyTier } from './loyalty-data-client';

// Tier display info for the loyalty hook, extracted so use-loyalty.ts
// stays under the 300-line limit. Merchant-defined ladder entries are
// authoritative: their multiplier and perk codes render as configured,
// and a configured rung with neither must not inherit the hardcoded
// marketing copy below (kept only for payloads that predate the tiers
// contract or rungs the merchant never configured).

const PERK_LABELS: Record<string, string> = {
  free_shipping: 'Free shipping',
  early_access: 'Early access to sales',
  exclusive_discounts: 'Exclusive discounts',
};

function humanizePerk(perk: string): string {
  const words = perk.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const TIER_COLORS = {
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

const TIER_BENEFITS = {
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

export interface LoyaltyTierInfo {
  colors: { bg: string; text: string; border: string };
  benefits: string[];
}

export function getLoyaltyTierInfo(
  tiers: LoyaltyTier[] | undefined,
  tier: string
): LoyaltyTierInfo {
  const colors =
    TIER_COLORS[tier as keyof typeof TIER_COLORS] || TIER_COLORS.bronze;

  const merchantTier = tiers?.find(
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
    // Authoritative even when empty: no hardcoded fallback copy.
    return { colors, benefits };
  }

  return {
    colors,
    benefits:
      TIER_BENEFITS[tier as keyof typeof TIER_BENEFITS] || TIER_BENEFITS.bronze,
  };
}

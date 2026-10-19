import { describe, expect, it } from 'vitest';
import type { LoyaltyTier } from './loyalty-data-client';
import { getLoyaltyTierInfo } from './loyalty-tier-info';

const LADDER: LoyaltyTier[] = [
  {
    name: 'Silver',
    minPoints: 100,
    multiplier: 1.25,
    perks: ['free_shipping'],
  },
  { name: 'Gold', minPoints: 500, multiplier: null, perks: [] },
];

describe('getLoyaltyTierInfo', () => {
  it('renders merchant multiplier and labelled perks', () => {
    const info = getLoyaltyTierInfo(LADDER, 'silver');
    expect(info.benefits).toEqual(['Earn 1.25x points', 'Free shipping']);
    expect(info.colors).toEqual({
      bg: 'bg-gray-100',
      text: 'text-gray-800',
      border: 'border-gray-300',
    });
  });

  it('keeps a configured rung with no perks authoritatively empty', () => {
    expect(getLoyaltyTierInfo(LADDER, 'gold').benefits).toEqual([]);
  });

  it('humanizes unknown perk codes', () => {
    const tiers: LoyaltyTier[] = [
      {
        name: 'VIP',
        minPoints: 1,
        multiplier: null,
        perks: ['concierge_line'],
      },
    ];
    expect(getLoyaltyTierInfo(tiers, 'vip').benefits).toEqual([
      'Concierge line',
    ]);
  });

  it('falls back to built-in copy for unconfigured tiers', () => {
    const info = getLoyaltyTierInfo(LADDER, 'platinum');
    expect(info.benefits).toContain('Earn 3x points');
    expect(info.colors.bg).toBe('bg-purple-100');
  });

  it('falls back to bronze styling for unknown tier names', () => {
    const info = getLoyaltyTierInfo(undefined, 'diamond');
    expect(info.colors.bg).toBe('bg-amber-100');
    expect(info.benefits).toContain('Access to basic rewards');
  });
});

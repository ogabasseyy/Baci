import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RewardsCatalog } from './rewards-catalog';

const mockUseLoyalty = vi.fn();

vi.mock('@/hooks/use-loyalty', () => ({
  useLoyalty: (...args: unknown[]) => mockUseLoyalty(...args),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('RewardsCatalog redemption cap disclosure', () => {
  it('advertises the capped effective percentage and discloses the cap', () => {
    mockUseLoyalty.mockReturnValue({
      loading: false,
      enrolled: true,
      pointsBalance: 1000,
      maxRedemptionPercentage: 25,
      availableRewards: [
        {
          id: 'reward-cap',
          name: 'Half off',
          description: 'A capped percentage reward',
          points_required: 300,
          reward_type: 'discount',
          discount_type: 'percentage',
          discount_value: 50,
        },
      ],
      redeemReward: vi.fn(),
      refetch: vi.fn(),
      getTierInfo: () => ({
        colors: { text: 'text-amber-800' },
        benefits: [],
      }),
    });

    render(<RewardsCatalog merchantId="merchant-1" customerId="customer-1" />);

    expect(screen.getByText('25% Off')).toBeInTheDocument();
    expect(
      screen.getByText(/Discount capped at 25% of the order subtotal/)
    ).toBeInTheDocument();
  });

  it('keeps the nominal percentage when the cap does not bind', () => {
    mockUseLoyalty.mockReturnValue({
      loading: false,
      enrolled: true,
      pointsBalance: 1000,
      maxRedemptionPercentage: 80,
      availableRewards: [
        {
          id: 'reward-nominal',
          name: 'Half off',
          description: 'An uncapped percentage reward',
          points_required: 300,
          reward_type: 'discount',
          discount_type: 'percentage',
          discount_value: 50,
        },
      ],
      redeemReward: vi.fn(),
      refetch: vi.fn(),
      getTierInfo: () => ({
        colors: { text: 'text-amber-800' },
        benefits: [],
      }),
    });

    render(<RewardsCatalog merchantId="merchant-1" customerId="customer-1" />);

    expect(screen.getByText('50% Off')).toBeInTheDocument();
  });
});

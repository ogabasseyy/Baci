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

describe('RewardsCatalog valueless manual discount', () => {
  it('labels a valueless plain discount as in-store, never ₦0 Off', () => {
    mockUseLoyalty.mockReturnValue({
      loading: false,
      enrolled: true,
      pointsBalance: 1000,
      maxRedemptionPercentage: 25,
      availableRewards: [
        {
          id: 'reward-manual',
          name: 'Manager special',
          description: 'Present the code in store',
          points_required: 300,
          reward_type: 'discount',
          discount_value: undefined,
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

    expect(screen.getByText('In-Store Discount')).toBeInTheDocument();
    expect(screen.queryByText(/0 Off/)).not.toBeInTheDocument();
    // Manual discounts never read the checkout cap.
    expect(screen.queryByText(/Discount capped at/)).not.toBeInTheDocument();
  });
});

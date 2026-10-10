import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RewardsCatalog } from './rewards-catalog';

const mockUseLoyalty = vi.fn();

vi.mock('@/hooks/use-loyalty', () => ({
  useLoyalty: (...args: unknown[]) => mockUseLoyalty(...args),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function loyaltyStateWithReward(reward: Record<string, unknown>) {
  return {
    loading: false,
    enrolled: true,
    pointsBalance: 1000,
    tier: 'gold',
    availableRewards: [reward],
    redeemReward: vi.fn(),
    refetch: vi.fn(),
    getTierInfo: () => ({
      colors: { text: 'text-amber-800' },
      benefits: [],
    }),
  };
}

const FIXED_DISCOUNT_REWARD = {
  id: 'reward-1',
  name: 'Flat discount',
  description: 'A flat-value discount reward',
  points_required: 500,
  reward_type: 'discount',
  discount_type: 'fixed',
  discount_value: 2000,
};

describe('RewardsCatalog', () => {
  it('renders a fixed-value discount reward label in NGN when no merchant currency is provided', () => {
    mockUseLoyalty.mockReturnValue(
      loyaltyStateWithReward(FIXED_DISCOUNT_REWARD)
    );

    render(<RewardsCatalog merchantId="merchant-1" customerId="customer-1" />);

    expect(screen.getByText('₦2,000 Off')).toBeInTheDocument();
  });

  it('renders a fixed-value discount reward label in the merchant payout currency for an INR merchant', () => {
    mockUseLoyalty.mockReturnValue(
      loyaltyStateWithReward(FIXED_DISCOUNT_REWARD)
    );

    render(
      <RewardsCatalog
        merchantId="merchant-1"
        customerId="customer-1"
        merchantCountry="IN"
        merchantPayoutCurrency="INR"
      />
    );

    expect(screen.getByText('₹2,000 Off')).toBeInTheDocument();
    expect(screen.queryByText(/₦/)).not.toBeInTheDocument();
  });

  it('renders a percentage discount reward label unaffected by merchant currency', () => {
    mockUseLoyalty.mockReturnValue(
      loyaltyStateWithReward({
        id: 'reward-2',
        name: 'Percentage discount',
        description: 'A percentage-value discount reward',
        points_required: 300,
        reward_type: 'discount',
        discount_type: 'percentage',
        discount_value: 10,
      })
    );

    render(
      <RewardsCatalog
        merchantId="merchant-1"
        customerId="customer-1"
        merchantCountry="IN"
        merchantPayoutCurrency="INR"
      />
    );

    expect(screen.getByText('10% Off')).toBeInTheDocument();
  });

  it('renders a store-credit reward as credit, not a discount code', () => {
    mockUseLoyalty.mockReturnValue(
      loyaltyStateWithReward({
        id: 'reward-3',
        name: 'Wallet top-up',
        description: 'Credit for your store balance',
        points_required: 100,
        reward_type: 'store_credit',
        discount_value: 500,
      })
    );

    render(<RewardsCatalog merchantId="merchant-1" customerId="customer-1" />);

    expect(screen.getByText('₦500 Store Credit')).toBeInTheDocument();
  });

  it('fires onRedeemed after a successful redemption', async () => {
    const mockRedeemReward = vi.fn().mockResolvedValue({ success: true });
    mockUseLoyalty.mockReturnValue({
      ...loyaltyStateWithReward({
        id: 'reward-4',
        name: 'Anything',
        description: 'Redeemable',
        points_required: 100,
        reward_type: 'discount',
        discount_type: 'fixed',
        discount_value: 100,
      }),
      redeemReward: mockRedeemReward,
    });
    const onRedeemed = vi.fn();

    render(
      <RewardsCatalog
        merchantId="merchant-1"
        customerId="customer-1"
        onRedeemed={onRedeemed}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Redeem' }));

    await waitFor(() => {
      expect(mockRedeemReward).toHaveBeenCalledWith('reward-4');
      expect(onRedeemed).toHaveBeenCalledTimes(1);
    });
  });

  it('shows credit-specific dialog text without a code for store_credit redemptions', async () => {
    const mockRedeemReward = vi.fn().mockResolvedValue({
      success: true,
      redemption_code: 'RDM-CREDIT',
      reward_type: 'store_credit',
      instructions: 'The credit has been added to your store balance.',
    });
    mockUseLoyalty.mockReturnValue({
      ...loyaltyStateWithReward({
        id: 'reward-7',
        name: 'Wallet top-up',
        description: 'Credit for your store balance',
        points_required: 100,
        reward_type: 'store_credit',
        discount_value: 500,
      }),
      redeemReward: mockRedeemReward,
    });

    render(<RewardsCatalog merchantId="merchant-1" customerId="customer-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Redeem' }));

    await waitFor(() => {
      expect(
        screen.getByText(/The credit is now on your store balance\./)
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: 'Copy redemption code' })
    ).not.toBeInTheDocument();
  });

  it('fires onRedeemed when redemption fails because the RPC may have mutated the balance', async () => {
    const mockRedeemReward = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'nope' });
    mockUseLoyalty.mockReturnValue({
      ...loyaltyStateWithReward({
        id: 'reward-5',
        name: 'Anything',
        description: 'Redeemable',
        points_required: 100,
        reward_type: 'discount',
        discount_type: 'fixed',
        discount_value: 100,
      }),
      redeemReward: mockRedeemReward,
    });
    const onRedeemed = vi.fn();

    render(
      <RewardsCatalog
        merchantId="merchant-1"
        customerId="customer-1"
        onRedeemed={onRedeemed}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Redeem' }));

    await waitFor(() => {
      expect(mockRedeemReward).toHaveBeenCalledWith('reward-5');
      expect(onRedeemed).toHaveBeenCalledTimes(1);
    });
  });

  it('refetches loyalty data when redemption fails so a stale balance clears', async () => {
    const mockRedeemReward = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'nope' });
    const mockRefetch = vi.fn();
    mockUseLoyalty.mockReturnValue({
      ...loyaltyStateWithReward({
        id: 'reward-6',
        name: 'Anything',
        description: 'Redeemable',
        points_required: 100,
        reward_type: 'discount',
        discount_type: 'fixed',
        discount_value: 100,
      }),
      redeemReward: mockRedeemReward,
      refetch: mockRefetch,
    });

    render(<RewardsCatalog merchantId="merchant-1" customerId="customer-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Redeem' }));

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });

  it('does not refetch on success because the hook already refreshed', async () => {
    const mockRedeemReward = vi.fn().mockResolvedValue({ success: true });
    const mockRefetch = vi.fn();
    mockUseLoyalty.mockReturnValue({
      ...loyaltyStateWithReward({
        id: 'reward-7',
        name: 'Anything',
        description: 'Redeemable',
        points_required: 100,
        reward_type: 'discount',
        discount_type: 'fixed',
        discount_value: 100,
      }),
      redeemReward: mockRedeemReward,
      refetch: mockRefetch,
    });

    render(<RewardsCatalog merchantId="merchant-1" customerId="customer-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Redeem' }));

    await waitFor(() => {
      expect(mockRedeemReward).toHaveBeenCalledWith('reward-7');
    });
    expect(mockRefetch).not.toHaveBeenCalled();
  });
});

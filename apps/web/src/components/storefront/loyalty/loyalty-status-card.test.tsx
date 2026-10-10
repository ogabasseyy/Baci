import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoyaltyStatusCard } from './loyalty-status-card';

const mockRefetch = vi.fn();
const mockUseLoyalty = vi.fn((..._args: unknown[]) => ({
  data: null,
  loading: false,
  enrolled: true,
  pointsBalance: 150,
  tier: 'bronze',
  nextTier: 'silver',
  pointsToNextTier: 850,
  getTierInfo: () => ({
    colors: { bg: 'bg-amber-100', text: 'text-amber-800' },
    benefits: [],
  }),
  refetch: mockRefetch,
}));

vi.mock('@/hooks/use-loyalty', () => ({
  useLoyalty: (...args: unknown[]) => mockUseLoyalty(...args),
}));

describe('LoyaltyStatusCard', () => {
  it('does not refetch on mount with the default token', () => {
    mockRefetch.mockClear();

    render(<LoyaltyStatusCard merchantId="m-1" customerId="c-1" />);

    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it('refetches when the parent bumps refreshToken', () => {
    mockRefetch.mockClear();

    const { rerender } = render(
      <LoyaltyStatusCard merchantId="m-1" customerId="c-1" refreshToken={0} />
    );
    expect(mockRefetch).not.toHaveBeenCalled();

    rerender(
      <LoyaltyStatusCard merchantId="m-1" customerId="c-1" refreshToken={1} />
    );
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});

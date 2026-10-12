import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => ({ slug: 'test-store' })),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: vi.fn(() => ({ customer: null })),
}));

vi.mock('@/hooks/use-loyalty', () => ({
  useLoyalty: vi.fn(() => ({
    enrolled: false,
    loading: false,
    recentTransactions: [],
    getTierInfo: vi.fn(),
    tier: null,
  })),
}));

vi.mock('@/components/storefront/loyalty/loyalty-enrollment-form', () => ({
  LoyaltyEnrollmentForm: vi.fn(() => null),
}));

vi.mock('@/components/storefront/loyalty/loyalty-status-card', () => ({
  LoyaltyStatusCard: vi.fn(() => null),
}));

vi.mock('@/components/storefront/loyalty/rewards-catalog', () => ({
  RewardsCatalog: vi.fn(() => null),
}));

const useMerchantSafeMock = vi.fn();
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => useMerchantSafeMock(),
}));

const { default: RewardsPage } = await import('./page');

describe('RewardsPage', () => {
  it('renders sr-only H1 in loading state when no merchant is in context yet', () => {
    useMerchantSafeMock.mockReturnValue(null);

    render(<RewardsPage />);

    // merchantId derives from context; null context -> loading branch renders sr-only H1
    const h1 = screen.queryByRole('heading', { level: 1, hidden: true });
    expect(h1).not.toBeNull();
    expect(h1?.textContent).toBe('Rewards');
    expect(h1?.className).toContain('sr-only');
  });

  it('renders the sign-in prompt once merchant context resolves and no customer is signed in', () => {
    useMerchantSafeMock.mockReturnValue({
      merchant: {
        id: 'merchant-1',
        business_name: 'Test Store',
        country: 'NG',
        payout_currency: 'NGN',
      },
      loading: false,
    });

    render(<RewardsPage />);

    const heading = screen.getByRole('heading', {
      level: 1,
      name: /rewards program/i,
    });
    expect(heading).toBeDefined();

    const signInLink = screen.getByRole('link', {
      name: /sign in to continue/i,
    });
    expect(signInLink).toHaveAttribute(
      'href',
      '/test-store/account/login?redirect=/test-store/pages/rewards'
    );
  });

  it('keeps the enrolled subtree mounted during a background refetch', async () => {
    useMerchantSafeMock.mockReturnValue({
      merchant: {
        id: 'merchant-1',
        business_name: 'Test Store',
        country: 'NG',
        payout_currency: 'NGN',
      },
      loading: false,
    });
    const { useCustomerAuth } = await import(
      '@/contexts/customer-auth-context'
    );
    vi.mocked(useCustomerAuth).mockReturnValue({
      customer: { id: 'customer-1' },
    } as never);
    const { useLoyalty } = await import('@/hooks/use-loyalty');
    const loyaltyMock = vi.mocked(useLoyalty);
    const settled = {
      enrolled: true,
      loading: false,
      recentTransactions: [],
      getTierInfo: vi.fn(),
      tier: null,
      refetch: vi.fn(),
    };
    loyaltyMock.mockReturnValue(settled as never);
    const { RewardsCatalog } = await import(
      '@/components/storefront/loyalty/rewards-catalog'
    );
    const catalogMock = vi.mocked(RewardsCatalog);

    const { rerender } = render(<RewardsPage />);
    expect(catalogMock).toHaveBeenCalled();

    // The catalog fires onRedeemed -> page refetch -> loading flips true
    // while old data is still rendered. The catalog (and its success
    // dialog) must survive; only the initial fetch shows the skeleton.
    catalogMock.mockClear();
    loyaltyMock.mockReturnValue({ ...settled, loading: true } as never);
    rerender(<RewardsPage />);

    expect(catalogMock).toHaveBeenCalled();
  });

  it('skeletons instead of showing the previous shopper after sign-in change', async () => {
    useMerchantSafeMock.mockReturnValue({
      merchant: {
        id: 'merchant-1',
        business_name: 'Test Store',
        country: 'NG',
        payout_currency: 'NGN',
      },
      loading: false,
    });
    const { useCustomerAuth } = await import(
      '@/contexts/customer-auth-context'
    );
    const authMock = vi.mocked(useCustomerAuth);
    authMock.mockReturnValue({ customer: { id: 'customer-1' } } as never);
    const { useLoyalty } = await import('@/hooks/use-loyalty');
    const loyaltyMock = vi.mocked(useLoyalty);
    const settled = {
      enrolled: true,
      loading: false,
      recentTransactions: [],
      getTierInfo: vi.fn(),
      tier: null,
      refetch: vi.fn(),
    };
    loyaltyMock.mockReturnValue(settled as never);
    const { RewardsCatalog } = await import(
      '@/components/storefront/loyalty/rewards-catalog'
    );
    const catalogMock = vi.mocked(RewardsCatalog);

    const { rerender } = render(<RewardsPage />);
    expect(catalogMock).toHaveBeenCalled();

    // New shopper while the new fetch is in flight (stale customer-1
    // data still in the hook): the previous enrolled subtree must not
    // paint. The gate keys on identity, not loading, so even the
    // pre-fetch frame skeletons.
    catalogMock.mockClear();
    authMock.mockReturnValue({ customer: { id: 'customer-2' } } as never);
    loyaltyMock.mockReturnValue({ ...settled, loading: true } as never);
    rerender(<RewardsPage />);

    expect(catalogMock).not.toHaveBeenCalled();
  });
});

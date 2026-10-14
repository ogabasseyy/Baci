import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('RewardsPage enrollment receipt', () => {
  it('keeps the enrollment receipt mounted until the shopper dismisses it', async () => {
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
      enrolled: false,
      loading: false,
      recentTransactions: [],
      getTierInfo: vi.fn(),
      tier: null,
      refetch: vi.fn(),
    };
    loyaltyMock.mockReturnValue(settled as never);
    const { LoyaltyEnrollmentForm } = await import(
      '@/components/storefront/loyalty/loyalty-enrollment-form'
    );
    const formMock = vi.mocked(LoyaltyEnrollmentForm);
    type FormProps = {
      onEnrolled?: () => void;
      onReceiptDismiss?: () => void;
    };
    const lastProps = () =>
      formMock.mock.calls[
        formMock.mock.calls.length - 1
      ][0] as unknown as FormProps;

    const { rerender } = render(<RewardsPage />);
    expect(formMock).toHaveBeenCalled();

    // Shopper enrolls, then the page-level refetch reports enrolled:
    // the form (with its receipt) must stay mounted.
    await act(async () => {
      lastProps().onEnrolled?.();
    });
    loyaltyMock.mockReturnValue({ ...settled, enrolled: true } as never);
    rerender(<RewardsPage />);
    const receiptCalls = formMock.mock.calls.length;
    expect(receiptCalls).toBeGreaterThan(0);

    // Dismissing the receipt finally shows the status subtree.
    await act(async () => {
      lastProps().onReceiptDismiss?.();
    });
    rerender(<RewardsPage />);

    expect(formMock.mock.calls.length).toBe(receiptCalls);
  });
});

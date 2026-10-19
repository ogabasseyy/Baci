import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSavingsWallet } from './local-savings-wallet';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const auth = vi.hoisted(() => ({
  user: null as { id: string } | null,
  isAuthenticated: false,
  isLoading: false,
  logout: vi.fn(),
}));
vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: () => auth,
}));
vi.mock(
  '@/components/storefront/customer-savings-drafts/customer-savings-draft-journey',
  () => ({
    CustomerSavingsDraftJourney: ({ userId }: { userId: string }) => (
      <p>Draft owner {userId}</p>
    ),
  })
);

describe('LocalSavingsWallet', () => {
  beforeEach(() => {
    auth.user = null;
    auth.isAuthenticated = false;
    auth.isLoading = false;
    auth.logout.mockReset();
  });
  it('links unauthenticated visitors to normal login with a wallet return path', () => {
    render(
      <LocalSavingsWallet merchantId="merchant" merchantSlug="ogabassey" />
    );
    expect(
      screen.getByRole('link', { name: 'Sign in to test savings' })
    ).toHaveAttribute(
      'href',
      '/ogabassey/account/login?redirect=%2Fogabassey%2Fwallet'
    );
    expect(screen.queryByRole('button', { name: 'Start saving' })).toBeNull();
  });
  it('waits for real authentication and removes the previous customer journey on logout', () => {
    auth.isLoading = true;
    const view = render(
      <LocalSavingsWallet merchantId="merchant" merchantSlug="ogabassey" />
    );
    expect(screen.getByRole('status')).toBeVisible();
    auth.isLoading = false;
    auth.isAuthenticated = true;
    auth.user = { id: 'synthetic-customer' };
    view.rerender(
      <LocalSavingsWallet merchantId="merchant" merchantSlug="ogabassey" />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start saving' }));
    expect(screen.getByText('Draft owner synthetic-customer')).toBeVisible();
    auth.isAuthenticated = false;
    auth.user = null;
    view.rerender(
      <LocalSavingsWallet merchantId="merchant" merchantSlug="ogabassey" />
    );
    expect(screen.queryByText('Draft owner synthetic-customer')).toBeNull();
  });
  it('reports a failed logout without pretending the session disappeared', async () => {
    auth.isAuthenticated = true;
    auth.user = { id: 'synthetic-customer' };
    auth.logout.mockRejectedValue(new Error('synthetic failure'));
    render(
      <LocalSavingsWallet merchantId="merchant" merchantSlug="ogabassey" />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-out failed'
    );
  });
});

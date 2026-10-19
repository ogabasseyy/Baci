import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { RewardsSignInPrompt } from './rewards-sign-in-prompt';

describe('RewardsSignInPrompt', () => {
  it('renders the sign-in prompt with member benefits', () => {
    render(<RewardsSignInPrompt slug="test-store" />);

    expect(
      screen.getByRole('heading', { name: 'Rewards Program' })
    ).not.toBeNull();
    expect(screen.getByText('Sign in to access rewards')).not.toBeNull();
    expect(screen.getByText('Earn Points')).not.toBeNull();
    expect(screen.getByText('Redeem Rewards')).not.toBeNull();
    expect(screen.getByText('Unlock Tiers')).not.toBeNull();
    expect(screen.getByText('Exclusive Access')).not.toBeNull();
  });

  it('links to the merchant-scoped login with a rewards redirect', () => {
    render(<RewardsSignInPrompt slug="test-store" />);

    const link = screen.getByRole('link', { name: 'Sign In to Continue' });
    expect(link.getAttribute('href')).toBe(
      '/test-store/account/login?redirect=/test-store/pages/rewards'
    );
  });
});

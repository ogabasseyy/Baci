import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ContentPageProviders } from './content-page-providers';

// Assert the composition contract at provider boundaries without loading
// network-backed merchant resolution or unrelated content widgets.
vi.mock('@/hooks/merchant/merchant-provider', () => ({
  MerchantProvider: ({
    slug,
    children,
  }: {
    slug: string;
    children: ReactNode;
  }) => (
    <div data-testid="merchant-provider" data-slug={slug}>
      {children}
    </div>
  ),
}));
vi.mock('@/contexts/storefront-context', () => ({
  StorefrontProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="storefront-provider">{children}</div>
  ),
}));
vi.mock('@/components/app-body', () => ({
  default: ({
    merchant,
    showCookieConsent = true,
    children,
  }: {
    merchant: { slug: string; business_name: string };
    showCookieConsent?: boolean;
    children: ReactNode;
  }) => (
    <div data-testid="app-body" data-merchant={merchant.business_name}>
      {showCookieConsent && <div role="dialog" aria-label="Cookie consent" />}
      {children}
    </div>
  ),
}));

describe('ContentPageProviders', () => {
  it('forwards merchant identity and nests content without adding another consent prompt', () => {
    const merchant = { slug: 'test-store', business_name: 'Test Store' };
    render(
      <ContentPageProviders merchant={merchant}>
        <main>Contact our store</main>
      </ContentPageProviders>
    );
    const merchantProvider = screen.getByTestId('merchant-provider');
    expect(merchantProvider).toHaveAttribute('data-slug', 'test-store');
    const storefrontProvider = within(merchantProvider).getByTestId(
      'storefront-provider'
    );
    const appBody = within(storefrontProvider).getByTestId('app-body');
    expect(appBody).toHaveAttribute('data-merchant', 'Test Store');
    expect(within(appBody).getByRole('main')).toHaveTextContent(
      'Contact our store'
    );
    expect(
      screen.queryByRole('dialog', { name: 'Cookie consent' })
    ).not.toBeInTheDocument();
  });
});

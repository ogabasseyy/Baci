import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: ComponentProps<'img'>) => (
    // biome-ignore lint/performance/noImgElement: test double
    <img {...props} alt={props.alt ?? ''} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { MobileHeaderOverlay } from './mobile-header-overlay';

vi.mock('@/components/storefront/blocks/header-search', () => ({
  HeaderSearch: () => <input aria-label="Search products" />,
}));

vi.mock('@/components/storefront/loyalty/loyalty-badge', () => ({
  LoyaltyBadge: () => <div data-testid="loyalty-badge" />,
}));

describe('MobileHeaderOverlay', () => {
  const baseProps = {
    customerSession: null,
    getHref: (path: string) => `/test-merchant${path}`,
    merchantId: 'merchant-1',
    navigationLinks: [{ label: 'Deals', url: '/deals' }],
    onClose: vi.fn(),
    onLogout: vi.fn(),
    onSearchChange: vi.fn(),
    searchRadius: 'md' as const,
    searchStyle: 'outline' as const,
    searchValue: '',
    showAccount: true,
    showSearch: true,
    userId: undefined,
  };

  it('renders nothing when closed', () => {
    const { container } = render(
      <MobileHeaderOverlay {...baseProps} mode="closed" />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the search panel with a close control', () => {
    const onClose = vi.fn();
    render(
      <MobileHeaderOverlay {...baseProps} mode="search" onClose={onClose} />
    );

    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Search products' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders menu links and closes on navigation', () => {
    const onClose = vi.fn();
    render(
      <MobileHeaderOverlay {...baseProps} mode="menu" onClose={onClose} />
    );

    const deals = screen.getByRole('link', { name: 'Deals' });
    expect(deals).toHaveAttribute('href', '/test-merchant/deals');

    fireEvent.click(deals);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders account links and signs out from the menu', () => {
    const onClose = vi.fn();
    const onLogout = vi.fn();
    render(
      <MobileHeaderOverlay
        {...baseProps}
        customerSession={{
          authenticated: true,
          customer: {
            first_name: 'Ada',
            last_name: 'Obi',
            email: 'ada@example.com',
          },
        }}
        mode="menu"
        onClose={onClose}
        onLogout={onLogout}
      />
    );

    expect(
      screen.getByText('Signed in as ada@example.com')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('Sign out'));
    expect(onLogout).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders the sign-in link when signed out', () => {
    render(<MobileHeaderOverlay {...baseProps} mode="menu" />);

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/test-merchant/account/login'
    );
  });
});

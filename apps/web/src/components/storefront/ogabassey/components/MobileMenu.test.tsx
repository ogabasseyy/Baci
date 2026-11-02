import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  merchantContext: {
    basePath: '/ogabassey',
    merchant: { business_name: 'Ogabassey' },
    navigationCategories: [{ name: 'Smartphones', slug: 'smartphones' }],
  } as {
    basePath?: string;
    merchant?: { business_name?: string };
    navigationCategories?: { name: string; slug: string }[];
  } | null,
  pathname: '/ogabassey/wallet',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/hooks/merchant/use-merchant', () => ({
  useMerchantSafe: () => mocks.merchantContext,
}));

vi.mock('../layout/logo', () => ({
  Logo: () => <span>Baci</span>,
}));

import { MobileMenu } from './MobileMenu';

describe('MobileMenu', () => {
  beforeEach(() => {
    mocks.pathname = '/ogabassey/wallet';
  });

  it('dismisses the open menu when Escape is pressed', () => {
    const onClose = vi.fn();

    render(<MobileMenu isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not attach Escape dismissal while closed', () => {
    const onClose = vi.fn();

    render(<MobileMenu isOpen={false} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('exposes consolidated shop, account, wallet, and support links with basePath-aware active state', () => {
    const onClose = vi.fn();

    render(<MobileMenu isOpen={true} onClose={onClose} />);

    expect(
      screen.getByRole('dialog', { name: /mobile menu/i })
    ).toHaveAttribute('aria-modal', 'true');

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/ogabassey'
    );
    expect(screen.getByRole('link', { name: 'All Products' })).toHaveAttribute(
      'href',
      '/ogabassey/products'
    );
    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveAttribute(
      'href',
      '/ogabassey/smartphones'
    );
    expect(screen.getByRole('link', { name: 'Wallet' })).toHaveAttribute(
      'href',
      '/ogabassey/wallet'
    );
    expect(screen.getByRole('link', { name: 'Wallet' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: 'Saved Items' })).toHaveAttribute(
      'href',
      '/ogabassey/wishlist'
    );
    expect(screen.getByRole('link', { name: 'IMEI Checker' })).toHaveAttribute(
      'href',
      '/ogabassey/imei-check'
    );
    expect(screen.getByRole('link', { name: 'Repairs' })).toHaveAttribute(
      'href',
      '/ogabassey/repairs'
    );
    expect(
      screen.getByRole('link', { name: 'Help & Support' })
    ).toHaveAttribute('href', '/ogabassey/faq');
  });

  it('marks only the most specific matching route as active on nested account paths', () => {
    mocks.pathname = '/ogabassey/account/orders';

    render(<MobileMenu isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(
      screen.getByRole('link', { name: 'My Account' })
    ).not.toHaveAttribute('aria-current');
  });
});

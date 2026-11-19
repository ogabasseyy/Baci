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

vi.mock('./logo', () => ({
  Logo: () => <span>Baci</span>,
}));

import { MobileMenu, OgabasseyMobileMenu } from './mobile-menu';

describe('mobile-menu (layout)', () => {
  beforeEach(() => {
    mocks.pathname = '/ogabassey/wallet';
    mocks.merchantContext = {
      basePath: '/ogabassey',
      merchant: { business_name: 'Ogabassey' },
      navigationCategories: [{ name: 'Smartphones', slug: 'smartphones' }],
    };
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

    expect(
      screen.getByRole('heading', { level: 2, name: 'Shop & Services' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Categories' })
    ).toBeInTheDocument();

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

  it('manages initial focus, focus trap, and body scroll lock', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender, unmount } = render(
      <MobileMenu isOpen={true} onClose={vi.fn()} />
    );

    const dialog = screen.getByRole('dialog', { name: /mobile menu/i });
    expect(dialog).toHaveAttribute('id', 'mobile-menu');

    const closeButton = screen.getByRole('button', { name: /close menu/i });
    expect(document.activeElement).toBe(closeButton);
    expect(document.body.style.overflow).toBe('hidden');

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]), [href]:not([disabled]):not([tabindex="-1"])'
    );
    const lastFocusable = focusable[focusable.length - 1];

    // Shift+Tab on first element wraps to last element
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastFocusable);

    // Tab on last element wraps back to first element
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(closeButton);

    // Closing via rerender (isOpen: true -> false) restores focus to trigger
    rerender(<MobileMenu isOpen={false} onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);

    unmount();
    document.body.removeChild(trigger);
  });

  it('reports appropriate closure reason on dismissal versus navigation', () => {
    const onClose = vi.fn();
    render(<MobileMenu isOpen={true} onClose={onClose} />);

    // Close button passes 'dismiss'
    fireEvent.click(screen.getByRole('button', { name: /close menu/i }));
    expect(onClose).toHaveBeenCalledWith('dismiss');

    onClose.mockClear();
    // Backdrop passes 'dismiss'
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledWith('dismiss');

    onClose.mockClear();
    // Navigating via link passes 'navigate'
    fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(onClose).toHaveBeenCalledWith('navigate');
  });

  it('renders through the OgabasseyMobileMenu named alias', () => {
    const onClose = vi.fn();
    render(<OgabasseyMobileMenu isOpen={true} onClose={onClose} />);

    expect(
      screen.getByRole('dialog', { name: /mobile menu/i })
    ).toBeInTheDocument();
  });

  it('normalizes category alias slugs, encodes URI characters, deduplicates canonical collisions, and skips blank slugs', () => {
    mocks.merchantContext = {
      basePath: '/ogabassey',
      merchant: { business_name: 'Ogabassey' },
      navigationCategories: [
        { name: 'Phones', slug: 'phones' },
        { name: 'Duplicate Smartphones', slug: 'smartphones' },
        { name: 'Laptops', slug: '  laptop  ' },
        { name: 'Smart TVs', slug: 'smart tvs' },
        { name: 'Empty Category', slug: '   ' },
      ],
    };

    render(<MobileMenu isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'Phones' })).toHaveAttribute(
      'href',
      '/ogabassey/smartphones'
    );
    expect(
      screen.queryByRole('link', { name: 'Duplicate Smartphones' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Laptops' })).toHaveAttribute(
      'href',
      '/ogabassey/laptops'
    );
    expect(screen.getByRole('link', { name: 'Smart TVs' })).toHaveAttribute(
      'href',
      '/ogabassey/smart%20tvs'
    );
    expect(
      screen.queryByRole('link', { name: 'Empty Category' })
    ).not.toBeInTheDocument();
  });

  it('omits the Categories section when all category slugs normalize to null', () => {
    mocks.merchantContext = {
      basePath: '/ogabassey',
      merchant: { business_name: 'Ogabassey' },
      navigationCategories: [{ name: 'Blank', slug: '   ' }],
    };

    render(<MobileMenu isOpen={true} onClose={vi.fn()} />);

    expect(
      screen.queryByRole('heading', { level: 2, name: 'Categories' })
    ).not.toBeInTheDocument();
  });
});

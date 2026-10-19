import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';


const mocks = vi.hoisted(() => ({
  asRoute: vi.fn((path: string) => path),
  defaultMerchantContext: {
    merchant: { id: 'merchant-1' },
    navigationCategories: [{ name: 'Phones', slug: 'phones' }],
  },
  merchantContext: {
    merchant: { id: 'merchant-1' },
    navigationCategories: [{ name: 'Phones', slug: 'phones' }],
  } as {
    merchant?: { id?: string };
    navigationCategories?: { name: string; slug: string }[];
  } | null,
  pathname: '/ogabassey',
  push: vi.fn(),
  // Active search-route query for the navbar's route-query sync reader.
  routeQuery: '',
  setIsCartOpen: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a
      href={href}
      data-prefetch={String(prefetch)}
      onClick={(event) => {
        onClick?.(event);
        mocks.push(href);
        event.preventDefault();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => mocks.pathname),
  useRouter: vi.fn(() => ({
    push: mocks.push,
    back: vi.fn(),
    replace: vi.fn(),
  })),
  useSearchParams: () => new URLSearchParams({ q: mocks.routeQuery }),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(() => ({
    totalItems: 3,
    isHydrated: true,
    setIsCartOpen: mocks.setIsCartOpen,
  })),
}));

vi.mock('@/hooks/merchant/use-merchant', () => ({
  useMerchantSafe: vi.fn(() => mocks.merchantContext),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: mocks.asRoute,
}));

vi.mock('./logo', () => ({
  Logo: () => <span>Store logo</span>,
}));

vi.mock('../components/GadgetPattern', () => ({
  GadgetPattern: () => null,
}));

vi.mock('../components/empty-state', () => ({
  EmptyState: () => null,
}));

import { OgabasseyNavbar } from './navbar';

describe('OgabasseyNavbar', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.asRoute.mockClear();
    mocks.merchantContext = mocks.defaultMerchantContext;
    mocks.pathname = '/ogabassey';
    mocks.push.mockClear();
    mocks.setIsCartOpen.mockClear();
  });


  it('keeps rendered links under the store slug when the slug includes a leading slash', async () => {
    const user = userEvent.setup();
    render(<OgabasseyNavbar storeSlug="/ogabassey" />);

    await user.click(screen.getByRole('button', { name: /shop by category/i }));

    await screen.findByRole('link', { name: 'Phones' });

    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));

    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/ogabassey',
        '/ogabassey/cart',
        '/ogabassey/account',
        '/ogabassey/smartphones',
        '/ogabassey/imei-check',
        '/ogabassey/repairs',
        '/ogabassey/wallet',
        '/ogabassey/blog',
      ])
    );
  });

  it('uses store-prefixed routes for navigation links', async () => {
    const user = userEvent.setup();
    render(<OgabasseyNavbar storeSlug="/ogabassey" />);

    await user.click(screen.getByRole('link', { name: /imei checker/i }));
    await user.click(screen.getByRole('link', { name: /repairs/i }));
    await user.click(screen.getByRole('link', { name: /wallet/i }));

    expect(mocks.push).toHaveBeenCalledWith('/ogabassey/imei-check');
    expect(mocks.push).toHaveBeenCalledWith('/ogabassey/repairs');
    expect(mocks.push).toHaveBeenCalledWith('/ogabassey/wallet');
  });

  it('gives the account link an explicit accessible name', () => {
    render(<OgabasseyNavbar storeSlug="/ogabassey" />);

    const accountLink = screen.getByRole('link', { name: /view account/i });

    expect(accountLink).toHaveAttribute('href', '/ogabassey/account');
    expect(accountLink).toHaveTextContent(/view account/i);
    const cartLink = screen.getByRole('link', {
      name: 'Open cart (3 items)',
    });

    expect(cartLink).toHaveAccessibleName('Open cart (3 items)');
    expect(cartLink).toHaveTextContent(/open cart \(3 items\)/i);
    expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true');
  });

  it('emits root-relative first-render links for domain-routed storefronts', async () => {
    const user = userEvent.setup();
    mocks.pathname = '/blog';

    render(<OgabasseyNavbar storeSlug="" />);

    await user.click(screen.getByRole('button', { name: /shop by category/i }));

    await screen.findByRole('link', { name: 'Phones' });

    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));

    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/',
        '/cart',
        '/account',
        '/smartphones',
        '/imei-check',
        '/repairs',
        '/wallet',
        '/blog',
      ])
    );
    expect(hrefs).toEqual(
      expect.not.arrayContaining([
        '/ogabassey',
        '/ogabassey/account',
        '/ogabassey/blog',
      ])
    );
  });

  it('disables prefetch on visible shell navigation links', async () => {
    const user = userEvent.setup();
    render(<OgabasseyNavbar storeSlug="/ogabassey" />);

    await user.click(screen.getByRole('button', { name: /shop by category/i }));

    expect(screen.getByRole('link', { name: /store logo/i })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
    expect(screen.getByRole('link', { name: /imei checker/i })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
    expect(screen.getByRole('link', { name: /repairs/i })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
    expect(screen.getByRole('link', { name: /wallet/i })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
    expect(await screen.findByRole('link', { name: 'Phones' })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
  });

});

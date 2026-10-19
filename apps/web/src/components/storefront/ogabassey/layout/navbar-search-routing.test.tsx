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

vi.mock('@/components/storefront/search-autocomplete', () => ({
  SearchAutocomplete: ({
    value,
    onChange,
    onSelectProduct,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSelectProduct: (url: string) => void;
  }) => (
    <div>
      <input
        type="search"
        aria-label="Search products"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        aria-label="Select product"
        onClick={() => onSelectProduct('/products/iphone%2015')}
      >
        Select product
      </button>
      <button
        type="button"
        aria-label="Select invalid product"
        onClick={() => onSelectProduct('https://example.com/bad')}
      >
        Select invalid product
      </button>
    </div>
  ),
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


  it('pushes store-prefixed product routes from search selection', async () => {
    const user = userEvent.setup();
    render(<OgabasseyNavbar storeSlug="/ogabassey" />);

    await user.click(screen.getByRole('searchbox', { name: /search products/i }));
    await user.click(await screen.findByRole('button', { name: /select product/i }));

    expect(mocks.push).toHaveBeenCalledWith('/ogabassey/products/iphone%2015');
  });

  it('reserves the mobile search row before merchant context is available', () => {
    mocks.merchantContext = null;

    const { container } = render(<OgabasseyNavbar storeSlug="/ogabassey" />);

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

    const searchWrap = container.querySelector<HTMLElement>(
      '.ogabassey-navbar__search-wrap'
    );
    const placeholder = container.querySelector<HTMLElement>(
      '.ogabassey-navbar-search--placeholder'
    );

    expect(searchWrap).toContainElement(placeholder);
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(
      placeholder?.querySelector('.ogabassey-navbar-search__input')
    ).toBeInTheDocument();
  });

  it('pushes store-prefixed blog search routes on the blog page', async () => {
    const user = userEvent.setup();
    mocks.pathname = '/ogabassey/blog';

    render(<OgabasseyNavbar storeSlug="/ogabassey" />);

    const input = screen.getByRole('searchbox', {
      name: /search blog posts/i,
    });

    await user.clear(input);
    await user.type(input, 'flash sale');
    await user.keyboard('{Enter}');

    expect(mocks.push).toHaveBeenCalledWith(
      '/ogabassey/blog?search=flash%20sale'
    );
  });

  it('rejects invalid product URLs from search selection', async () => {
    const user = userEvent.setup();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      render(<OgabasseyNavbar storeSlug="/ogabassey" />);

      await user.click(screen.getByRole('searchbox', { name: /search products/i }));
      await user.click(
        await screen.findByRole('button', { name: /select invalid product/i })
      );

      expect(mocks.asRoute).not.toHaveBeenCalledWith('https://example.com/bad');
      expect(mocks.push).not.toHaveBeenCalled();
      expect(consoleWarn).toHaveBeenCalledWith(
        'Invalid product URL rejected:',
        'https://example.com/bad'
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });

});

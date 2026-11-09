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
    onSubmitSearch,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSelectProduct: (url: string) => void;
    onSubmitSearch: (query: string) => void;
  }) => (
    <div>
      <input
        type="search"
        aria-label="Search products"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') onSubmitSearch(value); }}
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

vi.mock('next/headers', () => ({ headers: async () => new Headers([['host', 'ogabassey.com'], ['x-pathname', '/search']]) }));
vi.mock('@/lib/cached-data', () => ({ getRequestScopedMerchant: vi.fn(async () => ({ id: 'merchant-1', slug: 'ogabassey', template_id: 'ogabassey', business_name: 'Ogabassey', payout_currency: 'NGN' })) }));
vi.mock('@/lib/storefront-search', () => ({ getStorefrontSearchProducts: vi.fn(async () => ({ count: 0, products: [], productIds: [], query: 'iphone' })) }));
vi.mock('../components/GoogleAdManager', () => ({ GoogleAdManager: () => null }));
import { OgabasseyNavbar } from './navbar';
import { OgabasseyLayoutChrome } from '../storefront-layout-chrome';
import { SearchPageContent } from '@/app/(storefront)/[slug]/(catalog)/(listing)/search/search-page-content';

describe('OgabasseyNavbar', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.asRoute.mockClear();
    mocks.merchantContext = mocks.defaultMerchantContext;
    mocks.pathname = '/ogabassey';
    mocks.push.mockClear();
    mocks.setIsCartOpen.mockClear();
  });


  it('submits a new navbar search from the results page without a duplicate editor', async () => {
    mocks.pathname = '/ogabassey/search';
    const result = await SearchPageContent({ params: Promise.resolve({ slug: 'ogabassey' }), searchParams: Promise.resolve({ q: 'iphone' }) });
    const user = userEvent.setup();
    render(<><OgabasseyLayoutChrome section="header" basePath="/ogabassey" />{result}</>);
    expect(screen.queryByRole('form', { name: 'Edit search' })).toBeNull();
    await user.click(screen.getByRole('searchbox', { name: /search products/i }));
    await screen.findByRole('button', { name: /select product/i });
    const input = screen.getByRole('searchbox', { name: /search products/i });
    await user.clear(input);
    await user.type(input, 'samsung{enter}');
    expect(mocks.push).toHaveBeenCalledWith('/ogabassey/search?q=samsung');
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

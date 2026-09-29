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

vi.mock('next/dynamic', async () => {
  const react = await vi.importActual<typeof import('react')>('react');

  return {
    default: (
      loader: () => Promise<React.ComponentType<Record<string, unknown>>>
    ) => {
      return function DynamicComponentMock(props: Record<string, unknown>) {
        const [Resolved, setResolved] =
          react.useState<React.ComponentType<Record<string, unknown>> | null>(
            null
          );

        react.useEffect(() => {
          let isMounted = true;

          loader()
            .then((component) => {
              if (isMounted) {
                setResolved(() => component);
              }
            })
            .catch((error: unknown) => {
              if (isMounted) {
                setResolved(() => function DynamicImportError() {
                  throw error;
                });
              }
            });

          return () => {
            isMounted = false;
          };
        }, [loader]);

        return Resolved ? <Resolved {...props} /> : null;
      };
    },
  };
});

vi.mock('./mobile-menu', () => ({
  MobileMenu: (props: { isOpen: boolean; onClose: () => void }) => {
    if (!props.isOpen) {
      return null;
    }

    return (
      <div
        aria-label="Mobile menu"
        aria-modal="true"
        data-open={String(props.isOpen)}
        role="dialog"
      >
        <button type="button" onClick={props.onClose}>
          Close menu
        </button>
      </div>
    );
  },
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

import { useCart } from '@/hooks/cart';
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

  it('pushes store-prefixed product routes from search selection', async () => {
    const user = userEvent.setup();
    render(<OgabasseyNavbar storeSlug="/ogabassey" />);

    await user.click(screen.getByRole('searchbox', { name: /search products/i }));
    await user.click(await screen.findByRole('button', { name: /select product/i }));

    expect(mocks.push).toHaveBeenCalledWith('/ogabassey/products/iphone%2015');
  });

  it('names the mobile menu button for assistive technology', async () => {
    const user = userEvent.setup();
    render(<OgabasseyNavbar storeSlug="/ogabassey" />);

    const menuButton = screen.getByRole('button', { name: /open menu/i });

    expect(menuButton).toHaveAttribute('type', 'button');
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(menuButton);

    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    const mobileMenu = await screen.findByRole('dialog', {
      name: /mobile menu/i,
    });
    expect(mobileMenu).toHaveAttribute('data-open', 'true');

    await user.click(screen.getByRole('button', { name: /close menu/i }));

    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('dialog', { name: /mobile menu/i })
    ).not.toBeInTheDocument();
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

  it('keeps the cart badge stable until the cart provider hydrates', () => {
    vi.mocked(useCart).mockReturnValueOnce({
      totalItems: 3,
      isHydrated: false,
      setIsCartOpen: mocks.setIsCartOpen,
    } as unknown as ReturnType<typeof useCart>);

    render(<OgabasseyNavbar storeSlug="/ogabassey" />);

    expect(screen.getByText('0')).toHaveClass('ogabassey-navbar__cart-badge');
    expect(screen.getByText('0')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('0')).not.toHaveAttribute('data-visible');
    expect(screen.getByRole('link', { name: 'Open cart' })).toHaveAccessibleName(
      'Open cart'
    );
  });
});

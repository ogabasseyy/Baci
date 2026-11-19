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

  it('applies icon-link styling to mobile header actions for tap-target compliance', () => {
    render(<OgabasseyNavbar storeSlug="/ogabassey" />);

    const notificationsButton = screen.getByRole('button', {
      name: /toggle notifications/i,
    });
    const cartLink = screen.getByRole('link', { name: /open cart/i });
    const accountLink = screen.getByRole('link', { name: 'View account' });

    expect(notificationsButton).toHaveClass('ogabassey-navbar__icon-link');
    expect(cartLink).toHaveClass('ogabassey-navbar__icon-link');
    expect(accountLink).toHaveClass('ogabassey-navbar__icon-link');
  });

  it('caps the mobile navbar logo width with a 4.5rem floor to prevent wrapping and collapse on narrow viewports down to 320px', async () => {
    const { OGABASSEY_HOME_HEADER_CHROME_CRITICAL_CSS } = await import(
      '@/app/(storefront)/ogabassey/ogabassey-home-chrome-critical-css'
    );
    expect(OGABASSEY_HOME_HEADER_CHROME_CRITICAL_CSS).toContain(
      '.ogabassey-navbar__logo{height:2.25rem;max-width:clamp(4.5rem,calc(100vw - 15.5rem),18rem);width:auto}'
    );
  });
});

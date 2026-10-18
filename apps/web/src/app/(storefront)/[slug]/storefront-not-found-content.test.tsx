import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseMerchantSafe = vi.fn();

vi.mock('@/app/(storefront)/storefront-not-found.css', () => ({}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('@/components/themed/themed-button', () => ({
  ThemedButton: ({
    asChild,
    children,
  }: {
    asChild?: boolean;
    children: React.ReactNode;
  }) => (asChild ? children : <button type="button">{children}</button>),
}));

vi.mock('@/hooks/merchant/use-merchant', () => ({
  useMerchantSafe: () => mockUseMerchantSafe(),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: (value: string) => value,
}));

import { StorefrontNotFoundContent } from './storefront-not-found-content';

describe('StorefrontNotFoundContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMerchantSafe.mockReturnValue({
      basePath: '',
      loading: false,
      merchant: {
        business_name: 'Ogabassey',
        pages: { contact: true },
      },
    });
  });

  it('renders storefront navigation links for the missing page', () => {
    render(<StorefrontNotFoundContent />);

    expect(
      screen.getByRole('heading', { level: 1, name: /page not found/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute(
      'href',
      '/'
    );
    expect(screen.getByRole('link', { name: /all products/i })).toHaveAttribute(
      'href',
      '/#products'
    );
    expect(screen.getByRole('link', { name: /contact us/i })).toHaveAttribute(
      'href',
      '/pages/contact'
    );
  });

  it.each([
    {
      basePath: '/',
      contactHref: '/pages/contact',
      homeHref: '/',
      productsHref: '/#products',
    },
    {
      basePath: ' /ogabassey/ ',
      contactHref: '/ogabassey/pages/contact',
      homeHref: '/ogabassey/',
      productsHref: '/ogabassey/#products',
    },
  ])('normalizes $basePath before building recovery links', ({
    basePath,
    contactHref,
    homeHref,
    productsHref,
  }) => {
    mockUseMerchantSafe.mockReturnValue({
      basePath,
      loading: false,
      merchant: {
        business_name: 'Ogabassey',
        pages: { contact: true },
      },
    });

    render(<StorefrontNotFoundContent />);

    expect(
      screen.getByRole('link', { name: /back to ogabassey/i })
    ).toHaveAttribute('href', homeHref);
    expect(screen.getByRole('link', { name: /all products/i })).toHaveAttribute(
      'href',
      productsHref
    );
    expect(screen.getByRole('link', { name: /contact us/i })).toHaveAttribute(
      'href',
      contactHref
    );
  });

  it('renders an accessible loading state before merchant context resolves', () => {
    mockUseMerchantSafe.mockReturnValue({
      basePath: '',
      loading: true,
      merchant: null,
    });

    render(<StorefrontNotFoundContent />);

    expect(screen.getByRole('status', { name: /loading page/i })).toBeVisible();
    expect(
      screen.queryByRole('heading', { level: 1, name: /page not found/i })
    ).not.toBeInTheDocument();
  });

  it('omits the contact link when the merchant disables the contact page', () => {
    mockUseMerchantSafe.mockReturnValue({
      basePath: '',
      loading: false,
      merchant: {
        business_name: 'Ogabassey',
        pages: { contact: false },
      },
    });

    render(<StorefrontNotFoundContent />);

    expect(
      screen.getByRole('heading', { level: 1, name: /page not found/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /contact us/i })).toBeNull();
  });

  it('falls back to a generic store label when merchant is unavailable', () => {
    mockUseMerchantSafe.mockReturnValue({
      basePath: '',
      loading: false,
      merchant: null,
    });

    render(<StorefrontNotFoundContent />);

    expect(
      screen.getByRole('heading', { level: 1, name: /page not found/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /back to store/i })
    ).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: /contact us/i })).toBeNull();
  });
});

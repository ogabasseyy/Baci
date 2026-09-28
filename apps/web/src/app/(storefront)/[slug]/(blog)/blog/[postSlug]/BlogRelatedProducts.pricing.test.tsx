import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BlogRelatedProducts } from './BlogRelatedProducts';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

describe('BlogRelatedProducts pricing', () => {
  it('distinguishes catalog prices from quoted editorial amounts', () => {
    render(<BlogRelatedProducts basePath="" products={[]} />);
    expect(
      screen.getByText(/Historical and other quoted prices remain as written/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Open the product page to confirm the current price/)
    ).toBeInTheDocument();
  });

  it('renders the purchasable variant price instead of the stale parent price', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        currencySource={{ country: 'NG', payout_currency: 'NGN' }}
        products={[
          {
            id: 'product-6',
            name: 'iPad 10 Wi-Fi + Cellular',
            price: 150000,
            manage_stock: true,
            stock: 0,
            has_variants: true,
            variants: [{ price_override: 175000, stock_quantity: 2 }],
            slug: 'ipad-10',
          },
        ]}
      />
    );

    const link = screen.getByRole('link', {
      name: /ipad 10 wi-fi \+ cellular/i,
    });
    expect(link).toHaveTextContent('₦175,000');
    expect(link).not.toHaveTextContent('₦150,000');
  });

  it('does not advertise a positive parent price when selection requires a variant', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        currencySource={{ country: 'NG', payout_currency: 'NGN' }}
        products={[
          {
            id: 'product-positive-parent',
            name: 'Galaxy S25',
            price: 150000,
            manage_stock: true,
            stock: 5,
            has_variants: true,
            variants: [{ price_override: 175000, stock_quantity: 2 }],
            slug: 'galaxy-s25',
          },
        ]}
      />
    );

    const link = screen.getByRole('link', { name: /galaxy s25/i });
    expect(link).toHaveTextContent('₦175,000');
    expect(link).not.toHaveTextContent('₦150,000');
  });

  it('renders the purchasable condition-offer price instead of the parent price', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        currencySource={{ country: 'NG', payout_currency: 'NGN' }}
        products={[
          {
            id: 'product-7',
            name: 'iPhone 16 Used',
            price: 150000,
            manage_stock: true,
            stock: 0,
            has_condition_offers: true,
            has_purchasable_condition_offer: true,
            offers: [{ price: 125000, stock_quantity: 1 }],
            slug: 'iphone-16-used',
          },
        ]}
      />
    );

    const link = screen.getByRole('link', {
      name: /iphone 16 used/i,
    });
    expect(link).toHaveTextContent('₦125,000');
    expect(link).not.toHaveTextContent('₦150,000');
  });

  it('does not advertise an out-of-stock nullable parent price beside a stocked child', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        currencySource={{ country: 'NG', payout_currency: 'NGN' }}
        products={[
          {
            id: 'product-null-parent',
            name: 'iPad 10',
            price: 150000,
            manage_stock: null,
            stock: 0,
            has_variants: true,
            variants: [{ price_override: 175000, stock_quantity: 2 }],
            slug: 'ipad-10',
          },
        ]}
      />
    );

    const link = screen.getByRole('link', { name: /iPad 10/i });
    expect(link).toHaveTextContent('₦175,000');
    expect(link).not.toHaveTextContent('₦150,000');
  });

  it('advertises an unmanaged child price even when its quantity is zero', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        currencySource={{ country: 'NG', payout_currency: 'NGN' }}
        products={[
          {
            id: 'product-unmanaged-out-of-stock-child',
            name: 'iPad 10',
            price: 150000,
            manage_stock: false,
            has_variants: true,
            variants: [{ price_override: 175000, stock_quantity: 0 }],
            slug: 'ipad-10',
          },
        ]}
      />
    );

    const link = screen.getByRole('link', { name: /ipad 10/i });
    expect(link).toHaveTextContent('₦175,000');
    expect(link).not.toHaveTextContent('₦150,000');
  });

  it('renders a live price and unavailable state for managed stock', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        currencySource={{ country: 'NG', payout_currency: 'NGN' }}
        products={[
          {
            category_slug: 'smartphones',
            id: 'product-1',
            name: 'iPhone 16',
            price: 150000,
            manage_stock: true,
            stock: 0,
            slug: 'iphone-16',
          },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: /iphone 16/i })).toHaveTextContent(
      '₦150,000'
    );
    expect(screen.getByText('Currently unavailable')).toBeInTheDocument();
  });

  it('hides the parent price when variants fail to resolve', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        currencySource={{ country: 'NG', payout_currency: 'NGN' }}
        products={[
          {
            id: 'product-unresolved-variants',
            name: 'Pixel 9',
            price: 750000,
            manage_stock: false,
            has_variants: true,
            slug: 'pixel-9',
          },
        ]}
      />
    );

    // The variant RPC errored, so variants/has_purchasable_variant are
    // undefined: there may be no selectable SKU at the parent amount.
    // Availability stays fail-open, but no price is advertised (the
    // inline-token path prints "Check current price" for this state).
    expect(screen.queryByText('Currently unavailable')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /pixel 9/i })
    ).not.toHaveTextContent('₦750,000');
  });

  it('hides the parent price when variant selection is confirmed empty', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        currencySource={{ country: 'NG', payout_currency: 'NGN' }}
        products={[
          {
            id: 'product-confirmed-empty-variants',
            name: 'Galaxy S25',
            price: 850000,
            manage_stock: true,
            stock: 5,
            has_variants: true,
            has_purchasable_variant: false,
            variants: [],
            slug: 'galaxy-s25',
          },
        ]}
      />
    );

    // Successful hydration returned no public rows: no selectable SKU, so
    // the stocked parent price must not print next to the unavailable label.
    expect(screen.getByText('Currently unavailable')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /galaxy s25/i })
    ).not.toHaveTextContent('₦850,000');
  });

  it('hides the base price when the offer projection is unresolved', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        currencySource={{ country: 'NG', payout_currency: 'NGN' }}
        products={[
          {
            id: 'product-unresolved-offers',
            name: 'iPhone 16 Used',
            price: 400000,
            manage_stock: true,
            stock: 0,
            stock_quantity: 0,
            has_condition_offers: true,
            slug: 'iphone-16-used',
          },
        ]}
      />
    );

    // The offer RPC failed, so offers/has_purchasable_condition_offer are
    // undefined: stocked offers may exist, but the depleted base amount
    // must not print as the fallback.
    expect(
      screen.getByRole('link', { name: /iphone 16 used/i })
    ).not.toHaveTextContent('₦400,000');
  });
});

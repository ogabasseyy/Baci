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
});

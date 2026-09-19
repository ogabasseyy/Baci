import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BlogRelatedProducts } from './BlogRelatedProducts';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

describe('BlogRelatedProducts', () => {
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

  it('keeps the product link when optional live fields are absent', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        products={[
          {
            id: 'product-2',
            name: 'USB-C cable',
            slug: 'usb-c-cable',
          },
        ]}
      />
    );

    expect(
      screen.getByRole('link', { name: 'USB-C cable' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Currently unavailable')).not.toBeInTheDocument();
  });

  it('uses current stock when legacy stock is stale', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        products={[
          {
            id: 'product-3',
            name: 'USB-C charger',
            price: 20000,
            manage_stock: true,
            stock: 0,
            stock_quantity: 4,
            slug: 'usb-c-charger',
          },
        ]}
      />
    );

    expect(screen.queryByText('Currently unavailable')).not.toBeInTheDocument();
  });

  it('treats nullable managed-stock values as unlimited when effective stock is zero', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        products={[
          {
            id: 'product-null-managed-stock',
            name: 'Legacy phone',
            manage_stock: null,
            stock: 0,
            slug: 'legacy-phone',
          },
        ]}
      />
    );

    expect(screen.queryByText('Currently unavailable')).not.toBeInTheDocument();
  });

  it('does not show unavailable when a stocked condition offer can be purchased', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        products={[
          {
            id: 'product-4',
            name: 'iPhone 16 Used',
            slug: 'iphone-16-used',
            manage_stock: true,
            stock: 0,
            has_condition_offers: true,
            has_purchasable_condition_offer: true,
          },
        ]}
      />
    );

    expect(screen.queryByText('Currently unavailable')).not.toBeInTheDocument();
  });

  it('does not show unavailable when a stocked product variant can be purchased', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        products={[
          {
            id: 'product-5',
            name: 'iPad 10 Wi-Fi + Cellular',
            slug: 'ipad-10',
            manage_stock: true,
            stock: 0,
            has_variants: true,
            has_purchasable_variant: true,
          },
        ]}
      />
    );

    expect(screen.queryByText('Currently unavailable')).not.toBeInTheDocument();
  });

  it('does not show unavailable when a stocked child is supplied without summary flags', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        products={[
          {
            id: 'product-direct-child',
            name: 'Galaxy S25',
            manage_stock: null,
            stock: 0,
            variants: [{ stock_quantity: 2 }],
            slug: 'galaxy-s25',
          },
        ]}
      />
    );

    expect(screen.queryByText('Currently unavailable')).not.toBeInTheDocument();
  });

  it('shows unavailable when variant selection is confirmed empty', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        products={[
          {
            id: 'product-empty-variants',
            name: 'Galaxy S25',
            manage_stock: true,
            stock: 5,
            has_variants: true,
            has_purchasable_variant: false,
            slug: 'galaxy-s25',
          },
        ]}
      />
    );

    expect(screen.getByText('Currently unavailable')).toBeInTheDocument();
  });

  it('shows unavailable for an unmanaged parent with no purchasable variants', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        products={[
          {
            id: 'product-empty-unmanaged-variants',
            name: 'Galaxy S25',
            manage_stock: false,
            has_variants: true,
            has_purchasable_variant: false,
            slug: 'galaxy-s25',
          },
        ]}
      />
    );

    expect(screen.getByText('Currently unavailable')).toBeInTheDocument();
  });

  it('keeps an unmanaged nonempty variant set available when child quantity is zero', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        products={[
          {
            id: 'product-unmanaged-variants',
            name: 'Galaxy S25',
            manage_stock: false,
            has_variants: true,
            has_purchasable_variant: false,
            variants: [{ stock_quantity: 0 }],
            slug: 'galaxy-s25',
          },
        ]}
      />
    );

    expect(screen.queryByText('Currently unavailable')).not.toBeInTheDocument();
  });

  it('shows unavailable for a depleted serialized child under an unmanaged parent', () => {
    render(
      <BlogRelatedProducts
        basePath="/ogabassey"
        products={[
          {
            id: 'product-serialized-child',
            name: 'Galaxy S25 serialized variant',
            manage_stock: false,
            has_variants: true,
            has_purchasable_variant: false,
            variants: [
              {
                inventory_tracking_policy: 'serialized_strict',
                stock_quantity: 0,
              },
            ],
            slug: 'galaxy-s25',
          },
        ]}
      />
    );

    expect(screen.getByText('Currently unavailable')).toBeInTheDocument();
  });
});

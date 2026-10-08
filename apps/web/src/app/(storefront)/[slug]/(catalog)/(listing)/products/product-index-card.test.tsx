import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedProduct } from '@/lib/normalize-product';
import { ProductIndexCard } from './product-index-card';

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // biome-ignore lint/performance/noImgElement: test stub for next/image
    <img alt={alt} src={src} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    'aria-label': label,
  }: {
    children: ReactNode;
    href: string;
    'aria-label'?: string;
  }) => (
    <a href={href} aria-label={label}>
      {children}
    </a>
  ),
}));

function makeProduct(
  overrides: Partial<NormalizedProduct> = {}
): NormalizedProduct {
  return {
    id: 'product-1',
    name: 'iPhone 13 Pro',
    slug: 'iphone-13-pro',
    description: 'Phone',
    image: 'https://example.com/iphone.jpg',
    imageLarge: 'https://example.com/iphone.jpg',
    images: ['https://example.com/iphone.jpg'],
    category: 'Phones',
    category_slug: 'phones',
    brand: 'Apple',
    price: 550000,
    compare_at_price: null,
    condition: 'new',
    stock: 10,
    rating: 4.5,
    availability: 'InStock',
    available_conditions: [],
    variant_model: 'legacy',
    ...overrides,
  };
}

describe('ProductIndexCard', () => {
  it('falls back to condition-offer metadata when available_conditions is empty', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        pathPrefix=""
        product={makeProduct({
          available_conditions: [],
          condition: undefined,
          has_condition_offers: true,
        })}
      />
    );

    expect(screen.getByText('New & Used')).toBeInTheDocument();
  });

  it('falls back to the legacy product condition when available_conditions is empty', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        pathPrefix=""
        product={makeProduct({
          available_conditions: [],
          condition: ' refurbished ',
          has_condition_offers: false,
        })}
      />
    );

    expect(screen.getByText('Open Box')).toBeInTheDocument();
  });

  it('does not render a badge when no condition metadata is available', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        pathPrefix=""
        product={makeProduct({ available_conditions: [] })}
      />
    );

    expect(screen.queryByText('New')).not.toBeInTheDocument();
    expect(screen.queryByText('Multiple Conditions')).not.toBeInTheDocument();
  });

  it('does not render a badge when the only available condition is new', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        pathPrefix=""
        product={makeProduct({ available_conditions: [' New '] })}
      />
    );

    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });

  it('renders a deduplicated special-case badge for new and used products', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        pathPrefix=""
        product={makeProduct({
          available_conditions: [' used ', 'NEW', 'used'],
        })}
      />
    );

    expect(screen.getByText('New & Used')).toBeInTheDocument();
  });

  it('renders a normalized singleton badge for non-new conditions', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        pathPrefix=""
        product={makeProduct({
          available_conditions: [' Refurbished '],
        })}
      />
    );

    expect(screen.getByText('Open Box')).toBeInTheDocument();
  });

  it('renders a generic multiple-conditions badge for mixed condition sets', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        pathPrefix=""
        product={makeProduct({
          available_conditions: ['used', 'open_box', 'refurbished'],
        })}
      />
    );

    expect(screen.getByText('Multiple Conditions')).toBeInTheDocument();
  });

  it('labels the matched condition beside the matched price', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦200,000"
        pathPrefix=""
        product={makeProduct({
          available_conditions: ['new', 'used'],
          searchMatch: {
            productId: 'product-1',
            total: 1,
            price: 200000,
            condition: 'used',
          },
        })}
      />
    );

    expect(screen.getByText('Used')).toBeInTheDocument();
    expect(screen.queryByText('New & Used')).not.toBeInTheDocument();
  });

  it('omits the snapshot condition when an exact option id is present', () => {
    render(
      <ProductIndexCard
        modern
        formattedPrice="₦200,000"
        pathPrefix=""
        product={makeProduct({
          searchMatch: {
            productId: 'product-1',
            total: 1,
            price: 200000,
            offerId: 'o1',
            condition: 'used',
          },
        })}
      />
    );

    const href = screen
      .getByRole('link', { name: 'Choose iPhone 13 Pro to buy' })
      .getAttribute('href');
    expect(href).toContain('offer_id=o1');
    expect(href).not.toContain('condition=');
    expect(href).not.toContain('match_base=');
  });

  it('forwards a condition-only match without an exact id', () => {
    render(
      <ProductIndexCard
        modern
        formattedPrice="₦200,000"
        pathPrefix=""
        product={makeProduct({
          searchMatch: {
            productId: 'product-1',
            total: 1,
            price: 200000,
            condition: 'used',
          },
        })}
      />
    );

    expect(
      screen.getByRole('link', { name: 'Choose iPhone 13 Pro to buy' })
    ).toHaveAttribute('href', expect.stringContaining('condition=used'));
    expect(
      screen.getByRole('link', { name: 'Choose iPhone 13 Pro to buy' })
    ).toHaveAttribute('href', expect.stringContaining('match_base=1'));
  });

  it('shows the no-image fallback when the product image is blank', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        pathPrefix=""
        product={makeProduct({ image: '   ' })}
      />
    );

    expect(
      screen.getByRole('img', { name: 'No image available for iPhone 13 Pro' })
    ).toBeInTheDocument();
  });
});

it('shows modern search text and separate compare and purchase actions', () => {
  render(
    <ProductIndexCard
      modern
      footer={<button type="button">Compare</button>}
      formattedPrice="₦550,000"
      pathPrefix=""
      product={makeProduct({
        searchMatch: {
          productId: 'product-1',
          total: 1,
          price: 550000,
          variantId: 'v1',
          condition: 'used',
        },
      })}
    />
  );
  expect(screen.getByText('iPhone 13 Pro')).toBeInTheDocument();
  expect(screen.getByText('₦550,000')).toBeInTheDocument();
  expect(screen.queryByText('View')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Compare' }).closest('a')
  ).toBeNull();
  expect(
    screen.getByRole('link', { name: 'Choose iPhone 13 Pro to buy' })
  ).toHaveAttribute('href', expect.stringContaining('v1'));
});

it.each([
  {
    label: 'legacy variant match',
    product: { variant_model: 'legacy' as const, has_condition_offers: false },
    match: { variantId: 'v1' },
    expected: 'Options',
  },
  {
    label: 'plain product without a match',
    product: { variant_model: 'legacy' as const, has_condition_offers: false },
    match: undefined,
    expected: 'Buy',
  },
])('labels the card action $expected for a $label', ({
  product,
  match,
  expected,
}) => {
  render(
    <ProductIndexCard
      modern
      formattedPrice="₦550,000"
      pathPrefix=""
      product={makeProduct({
        ...product,
        ...(match
          ? {
              searchMatch: {
                productId: 'product-1',
                total: 1,
                price: 550000,
                ...match,
              },
            }
          : {}),
      })}
    />
  );
  expect(
    screen.getByRole('link', { name: 'Choose iPhone 13 Pro to buy' })
  ).toHaveTextContent(expected);
});

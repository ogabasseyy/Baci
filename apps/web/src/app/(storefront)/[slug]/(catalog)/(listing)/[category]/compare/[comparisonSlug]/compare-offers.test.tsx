import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getStorefrontLocale } from '@/lib/storefront-localization';
import { CompareOffers } from './compare-offers';

describe('CompareOffers', () => {
  it('renders both direct PDP anchors, price, condition, configuration and documented stock', () => {
    render(
      <CompareOffers
        locale="en-NG"
        currency="NGN"
        baseUrl="https://ogabassey.com"
        products={[
          {
            id: 'a',
            name: 'AirPods 4',
            slug: 'airpods-4',
            category_slug: 'earbuds',
            price: 192000,
            condition: 'New',
            in_stock: true,
          },
          {
            id: 'b',
            name: 'AirPods 4 ANC',
            slug: 'apple-airpods-4-anc',
            category_slug: 'earbuds',
            price: 221000,
            condition: 'Used',
            storage: '256GB',
            in_stock: false,
          },
        ]}
      />
    );
    expect(
      screen.getByRole('link', { name: 'View AirPods 4' })
    ).toHaveAttribute('href', 'https://ogabassey.com/earbuds/airpods-4');
    expect(
      screen.getByRole('link', { name: 'View AirPods 4 ANC' })
    ).toHaveAttribute(
      'href',
      'https://ogabassey.com/earbuds/apple-airpods-4-anc'
    );
    expect(screen.getByText(/192,000/)).toBeVisible();
    expect(screen.getByText('Condition: Used')).toBeVisible();
    expect(screen.getByText('Configuration: 256GB')).toBeVisible();
    expect(screen.getByText('Out of stock')).toBeVisible();
    expect(screen.getByText('In stock')).toBeVisible();
  });
});

it('formats a US merchant offer using the same storefront locale as the verdict', () => {
  render(
    <CompareOffers
      locale={getStorefrontLocale('US')}
      currency="USD"
      baseUrl="https://example.com"
      products={[
        {
          id: 'a',
          name: 'Phone',
          slug: 'phone',
          category_slug: 'smartphones',
          price: 192000,
        },
      ]}
    />
  );
  expect(screen.getByText('Starting price: $192,000')).toBeVisible();
  expect(
    screen.queryByText('Starting price: US$192,000')
  ).not.toBeInTheDocument();
});

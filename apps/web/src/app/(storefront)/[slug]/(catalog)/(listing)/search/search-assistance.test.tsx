import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SearchAssistance } from './search-assistance';

const products = [
  { price: 250000, condition: 'used' },
  { price: 900000, condition: 'new' },
];

describe('SearchAssistance', () => {
  it('links each compatible suggestion to its refined search', () => {
    render(
      <SearchAssistance
        query="iphone"
        resultQuery="iphone"
        products={products}
        criteria={{ brands: [], sort: 'relevance' }}
        basePath="/oga/search"
        currency="NGN"
      />
    );
    const group = screen.getByRole('group', { name: 'Search suggestions' });
    expect(group).toBeInTheDocument();
    const used = screen.getByRole('link', { name: 'Used iphone' });
    expect(used.getAttribute('href')).toContain('condition=used');
  });
  it('drops suggestions that conflict with the active price range', () => {
    render(
      <SearchAssistance
        query="iphone"
        resultQuery="iphone"
        products={products}
        criteria={{ brands: [], sort: 'relevance', minPrice: 800000 }}
        basePath="/oga/search"
        currency="NGN"
      />
    );
    // The budget suggestion (max 300k) conflicts with min 800k; the
    // condition suggestions still merge cleanly.
    expect(
      screen.queryByRole('link', { name: /up to ₦/ })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Used iphone' })
    ).toBeInTheDocument();
  });
  it('scales the budget suggestion to a non-naira storefront currency', () => {
    render(
      <SearchAssistance
        query="iphone"
        resultQuery="iphone"
        products={[
          { price: 380, condition: 'used' },
          { price: 1200, condition: 'new' },
        ]}
        criteria={{ brands: [], sort: 'relevance' }}
        basePath="/oga/search"
        currency="USD"
      />
    );
    const budget = screen.getByRole('link', { name: 'iphone up to US$400' });
    expect(budget.getAttribute('href')).toContain('maxPrice=400');
  });
  it('renders nothing while a different query is loading', () => {
    render(
      <SearchAssistance
        query="samsung"
        resultQuery="iphone"
        products={products}
        criteria={{ brands: [], sort: 'relevance' }}
        basePath="/oga/search"
        currency="NGN"
      />
    );
    expect(
      screen.queryByRole('group', { name: 'Search suggestions' })
    ).not.toBeInTheDocument();
  });
});

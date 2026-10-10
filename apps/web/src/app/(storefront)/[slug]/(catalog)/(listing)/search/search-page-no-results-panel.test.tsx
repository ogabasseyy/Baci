import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchPageNoResultsPanel } from './search-page-no-results-panel';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('SearchPageNoResultsPanel', () => {
  it('names the submitted query with recovery links', () => {
    render(
      <SearchPageNoResultsPanel
        allProductsHref="/ogabassey/products"
        contactHref="/ogabassey/contact"
        searchQuery="iphon"
      />
    );

    expect(
      screen.getByRole('heading', { name: /no products found/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/“iphon”/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /view all products/i })
    ).toHaveAttribute('href', '/ogabassey/products');
    expect(
      screen.getByRole('link', { name: /contact support/i })
    ).toHaveAttribute('href', '/ogabassey/contact');
  });

  it('offers intake for a searchable query without refinements', () => {
    render(
      <SearchPageNoResultsPanel
        allProductsHref="/ogabassey/products"
        contactHref="/ogabassey/contact"
        searchQuery="iphon"
        merchantSlug="ogabassey"
      />
    );

    expect(
      screen.getByRole('button', { name: /request this product/i })
    ).toBeInTheDocument();
  });

  it('hides intake when the query normalizes to no catalog term', () => {
    render(
      <SearchPageNoResultsPanel
        allProductsHref="/ogabassey/products"
        contactHref="/ogabassey/contact"
        searchQuery="!!"
        merchantSlug="ogabassey"
      />
    );

    expect(screen.getByText(/“!!”/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /request this product/i })
    ).not.toBeInTheDocument();
  });

  it.each([
    'a',
    'a'.repeat(121),
  ])('hides intake for queries outside the intake schema bounds (%s)', (searchQuery) => {
    render(
      <SearchPageNoResultsPanel
        allProductsHref="/ogabassey/products"
        contactHref="/ogabassey/contact"
        searchQuery={searchQuery}
        merchantSlug="ogabassey"
      />
    );

    expect(
      screen.queryByRole('button', { name: /request this product/i })
    ).not.toBeInTheDocument();
  });

  it('shows intake at the 120-character schema bound', () => {
    render(
      <SearchPageNoResultsPanel
        allProductsHref="/ogabassey/products"
        contactHref="/ogabassey/contact"
        searchQuery={'a'.repeat(120)}
        merchantSlug="ogabassey"
      />
    );

    expect(
      screen.getByRole('button', { name: /request this product/i })
    ).toBeInTheDocument();
  });
});

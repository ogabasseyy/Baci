import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchPageErrorPanel } from './search-page-error-panel';

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

describe('SearchPageErrorPanel', () => {
  it('offers retry and the all-products route without no-results copy', () => {
    render(
      <SearchPageErrorPanel
        allProductsHref="/ogabassey/products"
        query="iphone"
        retryHref="/ogabassey/search?q=iphone"
      />
    );

    expect(
      screen.getByRole('heading', { name: /temporarily unavailable/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /no products found/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /try again/i })).toHaveAttribute(
      'href',
      '/ogabassey/search?q=iphone'
    );
    expect(
      screen.getByRole('link', { name: /view all products/i })
    ).toHaveAttribute('href', '/ogabassey/products');
  });
});

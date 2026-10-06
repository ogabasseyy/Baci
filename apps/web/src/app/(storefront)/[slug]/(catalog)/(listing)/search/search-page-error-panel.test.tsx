import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchPageErrorPanel } from './search-page-error-panel';

const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

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
  it('offers a route refresh retry and the all-products route', () => {
    render(
      <SearchPageErrorPanel
        allProductsHref="/ogabassey/products"
        query="iphone"
      />
    );

    expect(
      screen.getByRole('heading', { name: /temporarily unavailable/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /no products found/i })
    ).not.toBeInTheDocument();

    // Retry refreshes the current route (re-executing the search) instead of
    // linking to the identical URL, which would reuse the cached error route.
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    expect(
      screen.getByRole('link', { name: /view all products/i })
    ).toHaveAttribute('href', '/ogabassey/products');
  });
});

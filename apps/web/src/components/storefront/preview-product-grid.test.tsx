import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreviewProductGrid } from './preview-product-grid';

describe('PreviewProductGrid', () => {
  it('matches published defaults for sparse saved ProductGrid configs', () => {
    render(<PreviewProductGrid />);

    expect(
      screen.getByRole('heading', { name: 'Shop By', level: 2 })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(12);
    expect(screen.getByTestId('builder-preview-product-grid')).toHaveClass(
      'lg:grid-cols-4'
    );
  });

  it('visibly applies candidate limit and showFilters controls without network access', () => {
    const fetchSpy = vi.spyOn(window, 'fetch');
    const { rerender } = render(
      <PreviewProductGrid
        columns={3}
        limit={2}
        showFilters={false}
        title="Featured"
      />
    );

    const fixture = screen.getByTestId('builder-preview-products');
    expect(fixture).toHaveAttribute('data-fixture-version', 'v2');
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('Sample price 1')).toBeInTheDocument();
    expect(screen.queryByText(/₦/)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('builder-preview-product-filters')
    ).not.toBeInTheDocument();

    rerender(
      <PreviewProductGrid columns={3} limit={24} showFilters title="Featured" />
    );

    expect(screen.getAllByRole('article')).toHaveLength(24);
    expect(
      screen.getByTestId('builder-preview-product-filters')
    ).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('matches storefront breakpoints before applying the configured large-screen columns', () => {
    render(<PreviewProductGrid columns={4} />);

    expect(screen.getByTestId('builder-preview-product-grid')).toHaveClass(
      'grid-cols-1',
      'sm:grid-cols-2',
      'md:grid-cols-3',
      'lg:grid-cols-4'
    );
    expect(screen.getByTestId('builder-preview-product-grid')).not.toHaveStyle({
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    });
  });
});

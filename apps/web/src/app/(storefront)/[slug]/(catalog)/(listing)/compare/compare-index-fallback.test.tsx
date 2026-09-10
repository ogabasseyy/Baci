import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompareIndexFallback } from './compare-index-fallback';

describe('CompareIndexFallback', () => {
  it('paints the compare hub LCP intro instead of a product-grid skeleton', () => {
    render(<CompareIndexFallback />);

    expect(
      screen.getByRole('status', { name: 'Loading compare products' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Compare products' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Breadcrumb' })
    ).toHaveTextContent('Home / Compare products');
    expect(
      screen.queryByRole('status', { name: 'Loading product listing' })
    ).not.toBeInTheDocument();
  });

  it('omits the hub chrome when the parent already committed the compare shell', () => {
    render(<CompareIndexFallback hideChrome />);

    expect(
      screen.getByRole('status', { name: 'Loading compare products' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Compare products' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Breadcrumb' })
    ).not.toBeInTheDocument();
  });

  it('omits the hub intro when the parent already committed LCP copy', () => {
    render(<CompareIndexFallback hideIntro />);

    expect(
      screen.getByRole('status', { name: 'Loading compare products' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Compare products' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Breadcrumb' })
    ).toBeInTheDocument();
  });
});

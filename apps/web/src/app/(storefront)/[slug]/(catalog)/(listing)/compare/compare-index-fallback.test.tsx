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
      screen.queryByRole('status', { name: 'Loading product listing' })
    ).not.toBeInTheDocument();
  });
});

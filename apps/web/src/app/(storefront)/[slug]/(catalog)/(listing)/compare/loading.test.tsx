import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Loading from './loading';

describe('compare loading', () => {
  it('paints the compare hub LCP intro instead of the catalog product-grid skeleton', () => {
    render(<Loading />);

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

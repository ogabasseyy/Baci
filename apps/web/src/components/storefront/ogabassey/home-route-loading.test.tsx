import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeRouteLoading } from './home-route-loading';

describe('HomeRouteLoading', () => {
  it('renders an accessible loading status container', () => {
    render(<HomeRouteLoading />);

    expect(
      screen.getByRole('status', { name: 'Loading storefront homepage' })
    ).toBeInTheDocument();
  });

  it('keeps serialized markup compact so LoadingBoundaryProvider does not bloat initial RSC Flight', () => {
    const html = renderToString(<HomeRouteLoading />);

    expect(html).toContain('aria-label="Loading storefront homepage"');
    expect(html.length).toBeLessThan(300);
  });
});

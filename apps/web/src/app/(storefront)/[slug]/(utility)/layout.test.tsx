import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { mockFullStorefrontCssImport } = vi.hoisted(() => ({
  mockFullStorefrontCssImport: vi.fn(),
}));

vi.mock('@/app/(storefront)/storefront-full.css', () => {
  mockFullStorefrontCssImport();
  return {};
});

import StorefrontFullCssLayout, { unstable_instant } from './layout';

describe('utility StorefrontFullCssLayout', () => {
  it('opts utility routes out of instant static-shell validation', () => {
    expect(unstable_instant).toBe(false);
  });

  it('loads the full storefront stylesheet for utility routes', () => {
    expect(mockFullStorefrontCssImport).toHaveBeenCalledOnce();
  });

  it('passes children through the storefront full-css route group', () => {
    render(
      <StorefrontFullCssLayout>
        <main>Utility content</main>
      </StorefrontFullCssLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Utility content');
  });
});

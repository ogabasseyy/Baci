import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockListingCssImport = vi.fn();
const mockCoreCssImport = vi.fn();

vi.mock('@/app/(storefront)/storefront-listing.css', () => {
  mockListingCssImport();
  return {};
});

vi.mock('@/app/(storefront)/storefront-core.css', () => {
  mockCoreCssImport();
  return {};
});

const { StorefrontEagerListingCssLayout } = await import(
  './storefront-eager-listing-css-layout'
);

describe('StorefrontEagerListingCssLayout', () => {
  it('statically imports core and listing CSS without pulling storefront-full.css', () => {
    expect(mockCoreCssImport).toHaveBeenCalledOnce();
    expect(mockListingCssImport).toHaveBeenCalledOnce();

    render(
      <StorefrontEagerListingCssLayout>
        <main>Scoped listing</main>
      </StorefrontEagerListingCssLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Scoped listing');
  });
});

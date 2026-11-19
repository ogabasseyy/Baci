import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockUtilityCssImport = vi.fn();
const mockCoreCssImport = vi.fn();

vi.mock('@/app/(storefront)/storefront-utility.css', () => {
  mockUtilityCssImport();
  return {};
});

vi.mock('@/app/(storefront)/storefront-core.css', () => {
  mockCoreCssImport();
  return {};
});

const { StorefrontEagerUtilityCssLayout } = await import(
  './storefront-eager-utility-css-layout'
);

describe('StorefrontEagerUtilityCssLayout', () => {
  it('statically imports core and utility CSS without pulling storefront-full.css', () => {
    expect(mockCoreCssImport).toHaveBeenCalledOnce();
    expect(mockUtilityCssImport).toHaveBeenCalledOnce();

    render(
      <StorefrontEagerUtilityCssLayout>
        <main>Scoped utility</main>
      </StorefrontEagerUtilityCssLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Scoped utility');
  });
});

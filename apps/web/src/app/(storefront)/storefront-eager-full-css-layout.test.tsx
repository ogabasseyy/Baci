import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockFullStorefrontCssImport = vi.fn();
const mockCoreStorefrontCssImport = vi.fn();

vi.mock('@/app/(storefront)/storefront-full.css', () => {
  mockFullStorefrontCssImport();
  return {};
});

vi.mock('@/app/(storefront)/storefront-core.css', () => {
  mockCoreStorefrontCssImport();
  return {};
});

const { StorefrontEagerFullCssLayout } = await import(
  './storefront-eager-full-css-layout'
);

describe('StorefrontEagerFullCssLayout', () => {
  it('statically imports core and full storefront CSS without waiting for first input', () => {
    expect(mockCoreStorefrontCssImport).toHaveBeenCalled();
    expect(mockFullStorefrontCssImport).toHaveBeenCalled();

    render(
      <StorefrontEagerFullCssLayout>
        <main>Untuned listing</main>
      </StorefrontEagerFullCssLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Untuned listing');
  });
});

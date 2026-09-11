import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFullStorefrontCssImport } = vi.hoisted(() => ({
  mockFullStorefrontCssImport: vi.fn(),
}));

vi.mock('@/app/(storefront)/storefront-core.css', () => ({}));
vi.mock('@/app/(storefront)/storefront-full.css', () => {
  mockFullStorefrontCssImport();
  return {};
});

import StorefrontFullCssLayout, { unstable_instant } from './layout';

function stubMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('utility StorefrontFullCssLayout', () => {
  beforeEach(() => {
    mockFullStorefrontCssImport.mockClear();
    stubMatchMedia(false);
  });

  it('opts utility routes out of instant static-shell validation', () => {
    expect(unstable_instant).toBe(false);
  });

  it('keeps the full storefront stylesheet off a mobile LCP path until the first input', async () => {
    expect(mockFullStorefrontCssImport).not.toHaveBeenCalled();

    render(
      <StorefrontFullCssLayout>
        <main>Utility content</main>
      </StorefrontFullCssLayout>
    );

    expect(mockFullStorefrontCssImport).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerdown'));

    await waitFor(() => {
      expect(mockFullStorefrontCssImport).toHaveBeenCalledOnce();
    });
  });

  it('defers the full storefront stylesheet for non-static tenants too', () => {
    render(
      <StorefrontFullCssLayout>
        <main>Other utility</main>
      </StorefrontFullCssLayout>
    );

    expect(screen.queryByTestId('eager-full-css')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Other utility');
    expect(mockFullStorefrontCssImport).not.toHaveBeenCalled();
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

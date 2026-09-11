import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFullStorefrontCssImport, mockLoadStylesheetAfterWindowLoad } =
  vi.hoisted(() => ({
    mockFullStorefrontCssImport: vi.fn(),
    mockLoadStylesheetAfterWindowLoad: vi.fn(
      (load: () => Promise<unknown>, _errorMessage: string) => {
        void load();
        return () => undefined;
      }
    ),
  }));

vi.mock('@/app/(storefront)/storefront-full.css', () => {
  mockFullStorefrontCssImport();
  return {};
});

vi.mock('@/app/(storefront)/load-stylesheet-after-window-load', () => ({
  loadStylesheetAfterWindowLoad: (
    load: () => Promise<unknown>,
    errorMessage: string
  ) => mockLoadStylesheetAfterWindowLoad(load, errorMessage),
}));

import StorefrontFullCssLayout, { unstable_instant } from './layout';

function stubMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('StorefrontFullCssLayout', () => {
  beforeEach(() => {
    mockFullStorefrontCssImport.mockClear();
    mockLoadStylesheetAfterWindowLoad.mockClear();
    stubMatchMedia(false);
  });

  it('opts listing routes out of instant static-shell validation', () => {
    expect(unstable_instant).toBe(false);
  });

  it('keeps the full storefront stylesheet off a mobile LCP path until the first input', async () => {
    expect(mockFullStorefrontCssImport).not.toHaveBeenCalled();

    render(
      <StorefrontFullCssLayout>
        <main>Listing content</main>
      </StorefrontFullCssLayout>
    );

    expect(mockFullStorefrontCssImport).not.toHaveBeenCalled();
    expect(mockLoadStylesheetAfterWindowLoad).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerdown'));

    await waitFor(() => {
      expect(mockFullStorefrontCssImport).toHaveBeenCalledOnce();
    });
  });

  it('starts the full storefront stylesheet on desktop during render', () => {
    stubMatchMedia(true);

    render(
      <StorefrontFullCssLayout>
        <main>Listing content</main>
      </StorefrontFullCssLayout>
    );

    expect(mockLoadStylesheetAfterWindowLoad).toHaveBeenCalledOnce();
  });

  it('passes children through the storefront full-css route group', () => {
    render(
      <StorefrontFullCssLayout>
        <main>Listing content</main>
      </StorefrontFullCssLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Listing content');
  });
});

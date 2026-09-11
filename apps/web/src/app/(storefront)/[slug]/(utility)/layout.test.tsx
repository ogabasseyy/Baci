import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
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

vi.mock('@/app/(storefront)/storefront-eager-full-css-layout', () => ({
  StorefrontEagerFullCssLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="eager-full-css">{children}</div>
  ),
}));

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
    mockLoadStylesheetAfterWindowLoad.mockClear();
    stubMatchMedia(false);
  });

  it('opts utility routes out of instant static-shell validation', () => {
    expect(unstable_instant).toBe(false);
  });

  it('keeps the full storefront stylesheet off a mobile LCP path until the first input for static tenants', async () => {
    expect(mockFullStorefrontCssImport).not.toHaveBeenCalled();

    render(
      await StorefrontFullCssLayout({
        children: <main>Utility content</main>,
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.queryByTestId('eager-full-css')).not.toBeInTheDocument();
    expect(mockFullStorefrontCssImport).not.toHaveBeenCalled();
    expect(mockLoadStylesheetAfterWindowLoad).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerdown'));

    await waitFor(() => {
      expect(mockFullStorefrontCssImport).toHaveBeenCalledOnce();
    });
  });

  it('starts the full storefront stylesheet on desktop during render for static tenants', async () => {
    stubMatchMedia(true);

    render(
      await StorefrontFullCssLayout({
        children: <main>Utility content</main>,
        params: Promise.resolve({ slug: 'ogabassey.com' }),
      })
    );

    expect(mockLoadStylesheetAfterWindowLoad).toHaveBeenCalledOnce();
  });

  it('eagerly styles utility routes for non-static tenants', async () => {
    render(
      await StorefrontFullCssLayout({
        children: <main>Other utility</main>,
        params: Promise.resolve({ slug: 'other-shop' }),
      })
    );

    expect(screen.getByTestId('eager-full-css')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Other utility');
  });

  it('passes children through the storefront full-css route group', async () => {
    render(
      await StorefrontFullCssLayout({
        children: <main>Utility content</main>,
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByRole('main')).toHaveTextContent('Utility content');
  });
});

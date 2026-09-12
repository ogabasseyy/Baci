import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHeaders = vi.hoisted(() => vi.fn());
const themeProviderAppearances: unknown[] = [];

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('@/components/storefront/storefront-theme-provider', () => ({
  StorefrontThemeProvider: ({
    appearance,
    children,
  }: {
    appearance?: unknown;
    children: ReactNode;
  }) => {
    themeProviderAppearances.push(appearance);
    return <div data-testid="storefront-theme-provider">{children}</div>;
  },
}));

vi.mock('./storefront-not-found-content', () => ({
  StorefrontNotFoundContent: () => <div>Missing storefront page</div>,
}));

vi.mock('@/app/(storefront)/storefront-eager-full-css-layout', () => ({
  StorefrontEagerFullCssLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="eager-full-css">{children}</div>
  ),
}));

import StorefrontNotFound from './not-found';

describe('StorefrontNotFound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    themeProviderAppearances.length = 0;
  });

  it('uses the OgaBassey system appearance when proxy headers identify the merchant', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([['x-merchant-slug', 'ogabassey']])
    );

    render(await StorefrontNotFound());

    expect(screen.getByText('Missing storefront page')).toBeInTheDocument();
    expect(screen.getByTestId('eager-full-css')).toBeInTheDocument();
    expect(themeProviderAppearances).toEqual([
      { mode: 'system', variant: 'ogabassey' },
    ]);
  });

  it('keeps scanning when an earlier candidate resolves to the default appearance', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([
        ['x-merchant-slug', 'unknown-storefront'],
        ['host', 'ogabassey.com'],
      ])
    );

    render(await StorefrontNotFound());

    expect(themeProviderAppearances).toEqual([
      { mode: 'system', variant: 'ogabassey' },
    ]);
  });

  it('uses the OgaBassey system appearance when the custom-domain host matches', async () => {
    mockHeaders.mockResolvedValue(new Headers([['host', 'ogabassey.com']]));

    render(await StorefrontNotFound());

    expect(themeProviderAppearances).toEqual([
      { mode: 'system', variant: 'ogabassey' },
    ]);
  });

  it('uses the OgaBassey system appearance when the custom-domain header matches', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([['x-custom-domain', 'OgaBassey.com:443']])
    );

    render(await StorefrontNotFound());

    expect(themeProviderAppearances).toEqual([
      { mode: 'system', variant: 'ogabassey' },
    ]);
  });

  it('does not use response-only pathname headers for path-based theming', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([['x-pathname', '/ogabassey.com/missing-page']])
    );

    render(await StorefrontNotFound());

    expect(screen.getByText('Missing storefront page')).toBeInTheDocument();
    expect(themeProviderAppearances).toEqual([]);
  });

  it('uses the OgaBassey system appearance when the forwarded host matches', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([['x-forwarded-host', 'ogabassey.com:443, proxy.local']])
    );

    render(await StorefrontNotFound());

    expect(themeProviderAppearances).toEqual([
      { mode: 'system', variant: 'ogabassey' },
    ]);
  });

  it('preserves the parent layout theme when request headers do not identify a known storefront', async () => {
    mockHeaders.mockResolvedValue(new Headers([['host', 'example.com']]));

    render(await StorefrontNotFound());

    expect(screen.getByText('Missing storefront page')).toBeInTheDocument();
    expect(themeProviderAppearances).toEqual([]);
  });
});

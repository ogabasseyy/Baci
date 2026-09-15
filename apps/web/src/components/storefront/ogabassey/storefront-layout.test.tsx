import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CatalogRouteLoading from '@/app/(storefront)/[slug]/(catalog)/loading';

const mocks = vi.hoisted(() => ({
  getOgabasseyBasePath: vi.fn(),
  getOgabasseyLayoutStyle: vi.fn(),
  shouldEnableOgabasseyGoogleStoreWidget: vi.fn(),
  prefetchDNS: vi.fn(),
  preconnect: vi.fn(),
  preload: vi.fn(),
}));

let shouldSuspendChrome = false;
const suspendedChromePromise = new Promise<never>(() => {
  // Keep chrome suspended to force the narrow fallback.
});

vi.mock('react-dom', () => ({
  prefetchDNS: mocks.prefetchDNS,
  preconnect: mocks.preconnect,
  preload: mocks.preload,
}));

vi.mock('@/components/analytics/deferred-google-store-widget', () => ({
  DeferredGoogleStoreWidget: ({
    enabled,
    merchant,
    merchantCustomDomain,
  }: {
    enabled: boolean;
    merchant?: { custom_domain?: string | null };
    merchantCustomDomain?: string | null;
  }) => (
    <div
      data-testid="google-store-widget"
      data-enabled={String(enabled)}
      data-domain={merchant?.custom_domain ?? merchantCustomDomain ?? ''}
    />
  ),
}));

vi.mock('@/components/storefront/ogabassey/storefront-shell-layout', () => ({
  StorefrontShellLayout: ({
    headerChrome,
    footerChrome,
    overlayChrome,
    children,
  }: {
    headerChrome?: ReactNode;
    footerChrome?: ReactNode;
    overlayChrome?: ReactNode;
    children: ReactNode;
  }) => (
    <div data-testid="shell-layout">
      {headerChrome}
      <div data-testid="shell-children">{children}</div>
      {footerChrome}
      {overlayChrome}
    </div>
  ),
}));

vi.mock('@/components/storefront/ogabassey/storefront-chrome-runtime', () => ({
  StorefrontChromeRuntime: ({
    section,
    basePath,
  }: {
    section: 'header' | 'footer' | 'overlay';
    basePath: string;
  }) => {
    if (shouldSuspendChrome) {
      throw suspendedChromePromise;
    }

    return (
      <div data-testid={`chrome-${section}`}>{`${section}:${basePath}`}</div>
    );
  },
}));

vi.mock('@/components/storefront/ogabassey/storefront-loading-ui', () => ({
  ShellChromeLoading: () => (
    <output aria-label="Loading storefront chrome">
      shared-shell-fallback
    </output>
  ),
  CatalogListingLoading: () => (
    <output aria-label="Loading product listing">
      catalog-route-loading
    </output>
  ),
}));

vi.mock('./storefront-layout-utils', () => ({
  getOgabasseyBasePath: (...args: unknown[]) => mocks.getOgabasseyBasePath(...args),
  getOgabasseyLayoutStyle: (...args: unknown[]) =>
    mocks.getOgabasseyLayoutStyle(...args),
  shouldEnableOgabasseyGoogleStoreWidget: (...args: unknown[]) =>
    mocks.shouldEnableOgabasseyGoogleStoreWidget(...args),
}));

import { OgabasseyStorefrontLayout } from './storefront-layout';
import { OGABASSEY_CDN_ORIGIN } from '@/components/storefront/ogabassey/config/storefront-origins';

const merchant = {
  id: 'merchant-1',
  user_id: 'user-1',
  business_name: 'Ogabassey',
  business_type: 'electronics',
  slug: 'ogabassey',
  custom_domain: 'ogabassey.com',
};

describe('OgabasseyStorefrontLayout', () => {
  beforeEach(() => {
    shouldSuspendChrome = false;
    mocks.getOgabasseyBasePath.mockReset();
    mocks.getOgabasseyLayoutStyle.mockReset();
    mocks.shouldEnableOgabasseyGoogleStoreWidget.mockReset();
    mocks.prefetchDNS.mockClear();
    mocks.preconnect.mockClear();
    mocks.preload.mockClear();
    mocks.getOgabasseyBasePath.mockReturnValue('/ogabassey');
    mocks.getOgabasseyLayoutStyle.mockReturnValue({
      '--store-primary': '#d62027',
    });
    mocks.shouldEnableOgabasseyGoogleStoreWidget.mockReturnValue(true);
  });

  it('routes the derived base path into the split runtime chrome sections', () => {
    render(
      <OgabasseyStorefrontLayout merchant={merchant}>
        <div>Storefront body</div>
      </OgabasseyStorefrontLayout>
    );

    expect(mocks.prefetchDNS).toHaveBeenCalledWith(OGABASSEY_CDN_ORIGIN);
    expect(mocks.preconnect).toHaveBeenCalledWith(OGABASSEY_CDN_ORIGIN);
    expect(mocks.preload).not.toHaveBeenCalled();
    expect(mocks.getOgabasseyBasePath).toHaveBeenCalledWith(
      'ogabassey',
      'path'
    );
    expect(screen.getByTestId('chrome-header')).toHaveTextContent(
      'header:/ogabassey'
    );
    expect(screen.getByTestId('chrome-footer')).toHaveTextContent(
      'footer:/ogabassey'
    );
    expect(screen.getByTestId('chrome-overlay')).toHaveTextContent(
      'overlay:/ogabassey'
    );
    expect(screen.getByText('Storefront body')).toBeInTheDocument();
    expect(screen.getByTestId('google-store-widget')).toHaveAttribute(
      'data-enabled',
      'true'
    );
    expect(screen.getByTestId('google-store-widget')).toHaveAttribute(
      'data-domain',
      'ogabassey.com'
    );
  });

  it('warms a crossorigin CDN preconnect instead of a static image preload when hero preload is requested', () => {
    render(
      <OgabasseyStorefrontLayout merchant={merchant} preloadHeroLcpImages>
        <div>Storefront body</div>
      </OgabasseyStorefrontLayout>
    );

    // The hero LCP image is now a dynamic launch-product image, so there is no
    // single static URL to <link rel=preload>; warm the CDN connection instead.
    expect(mocks.preload).not.toHaveBeenCalled();
    expect(mocks.preconnect).toHaveBeenCalledWith(OGABASSEY_CDN_ORIGIN, {
      crossOrigin: 'anonymous',
    });
  });

  it('passes domain routing mode through to the shared shell chrome', () => {
    mocks.getOgabasseyBasePath.mockReturnValue('');

    render(
      <OgabasseyStorefrontLayout merchant={merchant} routingMode="domain">
        <div>Storefront body</div>
      </OgabasseyStorefrontLayout>
    );

    expect(mocks.getOgabasseyBasePath).toHaveBeenCalledWith(
      'ogabassey',
      'domain'
    );
    expect(screen.getByTestId('chrome-header')).toHaveTextContent('header:');
    expect(screen.getByTestId('chrome-footer')).toHaveTextContent('footer:');
    expect(screen.getByTestId('chrome-overlay')).toHaveTextContent('overlay:');
  });

  it('keeps the Google Store widget mounted but disabled when merchant settings turn it off', () => {
    mocks.shouldEnableOgabasseyGoogleStoreWidget.mockReturnValue(false);

    render(
      <OgabasseyStorefrontLayout merchant={merchant}>
        <div>Storefront body</div>
      </OgabasseyStorefrontLayout>
    );

    expect(screen.getByTestId('google-store-widget')).toHaveAttribute(
      'data-enabled',
      'false'
    );
    expect(screen.getByTestId('google-store-widget')).toHaveAttribute(
      'data-domain',
      'ogabassey.com'
    );
  });

  it('keeps route content visible while runtime chrome resolves behind a narrow fallback', () => {
    shouldSuspendChrome = true;

    render(
      <OgabasseyStorefrontLayout merchant={merchant}>
        <div>Storefront body</div>
      </OgabasseyStorefrontLayout>
    );

    expect(screen.getByText('Storefront body')).toBeInTheDocument();
    expect(
      screen.getAllByRole('status', { name: 'Loading storefront chrome' })
    ).toHaveLength(2);
    expect(
      screen.getAllByRole('status', { name: 'Loading storefront chrome' })[0]
        ?.parentElement
    ).toHaveClass('ogabassey-header-chrome-loading');
  });

  it('does not reserve a hidden header slot when navigation is explicitly disabled', () => {
    shouldSuspendChrome = true;

    render(
      <OgabasseyStorefrontLayout merchant={merchant} hideNavigation>
        <div>Storefront body</div>
      </OgabasseyStorefrontLayout>
    );

    expect(screen.getAllByRole('status', { name: 'Loading storefront chrome' })).toHaveLength(1);
    expect(screen.getByTestId('shell-layout').firstElementChild).not.toHaveClass(
      'ogabassey-header-chrome-loading'
    );
  });

  it('keeps the shared shell frame mounted while a route-family loader owns the content slot', () => {
    shouldSuspendChrome = true;

    render(
      <OgabasseyStorefrontLayout merchant={merchant}>
        <CatalogRouteLoading />
      </OgabasseyStorefrontLayout>
    );

    expect(screen.getByTestId('shell-layout')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('shell-children')).getByRole('status', {
        name: 'Loading product listing',
      })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('status', { name: 'Loading storefront chrome' })
    ).toHaveLength(2);
  });
});

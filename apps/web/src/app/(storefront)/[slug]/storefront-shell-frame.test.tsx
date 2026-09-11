import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StorefrontShellFrame } from './storefront-shell-frame';

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

vi.mock('@/hooks/merchant/storefront-merchant-provider', () => ({
  StorefrontMerchantProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/hooks/cart/storefront-cart-provider', () => ({
  StorefrontCartProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/components/storefront/webmcp-storefront-tools', () => ({
  WebMcpStorefrontTools: () => null,
}));

vi.mock('@/components/storefront/deferred-page-view-tracker', () => ({
  DeferredPageViewTracker: () => null,
}));

vi.mock('./storefront-layout-renderer', () => ({
  StorefrontLayoutRenderer: ({ children }: { children: ReactNode }) => (
    <div data-testid="layout-renderer">{children}</div>
  ),
}));

const shellSnapshot = {
  merchant: {
    id: 'merchant-1',
    slug: 'ogabassey',
  },
  routingMode: 'domain' as const,
};

describe('StorefrontShellFrame', () => {
  it('renders children inside the merchant shell', () => {
    render(
      <StorefrontShellFrame
        preloadHeroLcpImages={false}
        shellSnapshot={shellSnapshot as never}
      >
        <main>Shell body</main>
      </StorefrontShellFrame>
    );

    expect(screen.getByTestId('layout-renderer')).toHaveTextContent(
      'Shell body'
    );
  });

  it('calls notFound when the shell snapshot is missing', () => {
    expect(() =>
      render(
        <StorefrontShellFrame preloadHeroLcpImages={false} shellSnapshot={null}>
          <main>Missing</main>
        </StorefrontShellFrame>
      )
    ).toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});

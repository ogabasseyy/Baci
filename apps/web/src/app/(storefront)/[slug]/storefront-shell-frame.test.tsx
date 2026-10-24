import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontCartProvider } from '@/hooks/cart/storefront-cart-provider';
import { StorefrontShellFrame } from './storefront-shell-frame';

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('@/components/analytics/chatgpt-pixel', () => ({
  ChatgptPixel: ({ pixelId }: { pixelId: string }) => (
    <span data-testid="chatgpt-pixel">{pixelId}</span>
  ),
}));

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

vi.mock('@/hooks/merchant/storefront-merchant-provider', () => ({
  StorefrontMerchantProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/hooks/cart/storefront-cart-provider', () => ({
  StorefrontCartProvider: vi.fn(({ children }: { children: ReactNode }) => (
    <>{children}</>
  )),
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

  it('mounts the consent-aware Pixel in the persistent shell for a direct product landing and checkout navigation', () => {
    const props = {
      preloadHeroLcpImages: false,
      shellSnapshot: {
        ...shellSnapshot,
        chatgptPixelId: 'pixel-landing',
      } as never,
    };
    const view = render(
      <StorefrontShellFrame {...props}>
        <main>Product landing</main>
      </StorefrontShellFrame>
    );
    expect(screen.getAllByTestId('chatgpt-pixel')).toHaveLength(1);
    expect(screen.getByTestId('chatgpt-pixel')).toHaveTextContent(
      'pixel-landing'
    );
    view.rerender(
      <StorefrontShellFrame {...props}>
        <main>Checkout</main>
      </StorefrontShellFrame>
    );
    expect(screen.getAllByTestId('chatgpt-pixel')).toHaveLength(1);
    expect(screen.getByText('Checkout')).toBeInTheDocument();
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

describe('StorefrontShellFrame cart wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables the shared cart for merchants with an explicit grant', () => {
    render(
      <StorefrontShellFrame
        preloadHeroLcpImages={false}
        shellSnapshot={
          {
            merchant: {
              id: 'merchant-1',
              plan_tier: 'free',
              premium_features: ['shared_cart'],
              slug: 'ogabassey',
            },
            routingMode: 'domain',
          } as never
        }
      >
        <main>Shell body</main>
      </StorefrontShellFrame>
    );

    expect(vi.mocked(StorefrontCartProvider).mock.calls[0]?.[0]).toMatchObject({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      sharedCartEnabled: true,
    });
  });

  it('keeps the legacy cart without the grant', () => {
    render(
      <StorefrontShellFrame
        preloadHeroLcpImages={false}
        shellSnapshot={
          {
            merchant: {
              id: 'merchant-1',
              plan_tier: 'pro',
              premium_features: [],
              slug: 'ogabassey',
            },
            routingMode: 'domain',
          } as never
        }
      >
        <main>Shell body</main>
      </StorefrontShellFrame>
    );

    expect(vi.mocked(StorefrontCartProvider).mock.calls[0]?.[0]).toMatchObject({
      merchantId: 'merchant-1',
      sharedCartEnabled: false,
    });
  });
});

it('wires anonymous derived capability hints into the storefront cart', () => {
  vi.clearAllMocks();
  render(
    <StorefrontShellFrame
      preloadHeroLcpImages={false}
      shellSnapshot={
        {
          ...shellSnapshot,
          merchant: {
            ...shellSnapshot.merchant,
            shared_cart_enabled: true,
            shared_cart_accounts_enabled: false,
            shared_cart_realtime_enabled: true,
          },
        } as never
      }
    >
      <main>Public shell</main>
    </StorefrontShellFrame>
  );
  expect(vi.mocked(StorefrontCartProvider).mock.calls[0]?.[0]).toMatchObject({
    sharedCartEnabled: true,
    sharedCartAccountsEnabled: false,
    sharedCartRealtimeEnabled: true,
  });
});

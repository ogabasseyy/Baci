import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsPixelProvider } from '@/components/analytics/analytics-pixel-provider';
import { StorefrontCartProvider } from '@/hooks/cart/storefront-cart-provider';
import type { StorefrontShellSnapshot } from '@/hooks/merchant/types';
import { StorefrontShellFrame } from './storefront-shell-frame';

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('@/components/analytics/twitter-pixel', () => ({
  TwitterPixel: ({
    pixelId,
    eventIds,
  }: {
    pixelId: string;
    eventIds?: Record<string, string | undefined>;
  }) => (
    <span data-testid="x-pixel" data-events={JSON.stringify(eventIds)}>
      {pixelId}
    </span>
  ),
}));

vi.mock('@/components/analytics/chatgpt-pixel', () => ({
  ChatgptPixel: ({ pixelId }: { pixelId: string }) => (
    <span data-testid="chatgpt-pixel">{pixelId}</span>
  ),
}));

vi.mock('@/components/analytics/facebook-pixel', () => ({
  FacebookPixel: ({ pixelId }: { pixelId: string }) => (
    <span data-testid="facebook-pixel">{pixelId}</span>
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
    user_id: 'user-1',
    business_name: 'Ogabassey',
    business_type: 'electronics',
    slug: 'ogabassey',
  },
  routingMode: 'domain',
  basePath: '',
  navigationCategories: [],
} satisfies StorefrontShellSnapshot;

describe('StorefrontShellFrame', () => {
  it('renders children inside the merchant shell', () => {
    render(
      <StorefrontShellFrame
        preloadHeroLcpImages={false}
        shellSnapshot={shellSnapshot}
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
      } satisfies StorefrontShellSnapshot,
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
            ...shellSnapshot,
            merchant: {
              ...shellSnapshot.merchant,
              id: 'merchant-1',
              plan_tier: 'free',
              premium_features: ['shared_cart'],
              slug: 'ogabassey',
            },
            routingMode: 'domain',
          } satisfies StorefrontShellSnapshot
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
            ...shellSnapshot,
            merchant: {
              ...shellSnapshot.merchant,
              id: 'merchant-1',
              plan_tier: 'pro',
              premium_features: [],
              slug: 'ogabassey',
            },
            routingMode: 'domain',
          } satisfies StorefrontShellSnapshot
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
        } satisfies StorefrontShellSnapshot
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

it('keeps one Meta Pixel on direct product landing and cart navigation', () => {
  const props = {
    preloadHeroLcpImages: false,
    shellSnapshot: {
      ...shellSnapshot,
      merchant: {
        ...shellSnapshot.merchant,
        growth_integrations_enabled: true,
        feature_settings: { facebook_pixel_id: '2099259280261589' },
      },
    } satisfies StorefrontShellSnapshot,
  };
  const view = render(
    <StorefrontShellFrame {...props}>
      <main>Product</main>
    </StorefrontShellFrame>
  );
  expect(screen.getAllByTestId('facebook-pixel')).toHaveLength(1);
  view.rerender(
    <StorefrontShellFrame {...props}>
      <main>Cart</main>
    </StorefrontShellFrame>
  );
  expect(screen.getAllByTestId('facebook-pixel')).toHaveLength(1);
});

it('mounts the merchant X Pixel on a direct product landing independently of the homepage', () => {
  render(
    <StorefrontShellFrame
      preloadHeroLcpImages={false}
      shellSnapshot={{
        ...shellSnapshot,
        merchant: {
          ...shellSnapshot.merchant,
          growth_integrations_enabled: true,
          feature_settings: {
            twitter_pixel_id: 'abc',
            twitter_event_ids: { viewContent: 'tw-abc-view' },
          },
        },
      }}
    >
      <main>Direct product</main>
    </StorefrontShellFrame>
  );
  expect(screen.getByTestId('x-pixel')).toHaveTextContent('abc');
});

vi.mock('@/components/analytics/tiktok-pixel', () => ({
  TikTokPixel: ({ pixelId }: { pixelId: string }) => (
    <span data-testid="tiktok-pixel">{pixelId}</span>
  ),
}));
vi.mock('@/components/analytics/snapchat-pixel', () => ({
  SnapchatPixel: ({ pixelId }: { pixelId: string }) => (
    <span data-testid="snapchat-pixel">{pixelId}</span>
  ),
}));
it('mounts all five merchant advertising pixels once across direct landing and navigation, preserving X event mapping', () => {
  const settings = {
    facebook_pixel_id: 'facebook-one',
    chatgpt_pixel_id: 'chatgpt-one',
    tiktok_pixel_id: 'TIKTOKONE',
    snapchat_pixel_id: '11111111-1111-4111-8111-111111111111',
    twitter_pixel_id: 'abc',
    twitter_event_ids: {
      viewContent: 'tw-abc-view',
      purchase: 'tw-abc-purchase',
    },
  };
  const snapshot = {
    ...shellSnapshot,
    chatgptPixelId: 'chatgpt-one',
    merchant: {
      ...shellSnapshot.merchant,
      growth_integrations_enabled: true,
      feature_settings: settings,
    },
  } as unknown as StorefrontShellSnapshot;
  const view = render(
    <StorefrontShellFrame preloadHeroLcpImages={false} shellSnapshot={snapshot}>
      <AnalyticsPixelProvider merchant={settings} />
      <main>Direct product</main>
    </StorefrontShellFrame>
  );
  for (const id of [
    'facebook-pixel',
    'chatgpt-pixel',
    'tiktok-pixel',
    'snapchat-pixel',
    'x-pixel',
  ])
    expect(screen.getAllByTestId(id)).toHaveLength(1);
  expect(screen.getByTestId('x-pixel')).toHaveAttribute(
    'data-events',
    JSON.stringify(settings.twitter_event_ids)
  );
  view.rerender(
    <StorefrontShellFrame preloadHeroLcpImages={false} shellSnapshot={snapshot}>
      <AnalyticsPixelProvider merchant={settings} />
      <main>Cart route</main>
    </StorefrontShellFrame>
  );
  for (const id of [
    'facebook-pixel',
    'chatgpt-pixel',
    'tiktok-pixel',
    'snapchat-pixel',
    'x-pixel',
  ])
    expect(screen.getAllByTestId(id)).toHaveLength(1);
});

// @vitest-environment-options {"url":"https://shop.example.com"}
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatwootWidget } from './chatwoot-widget';
import {
  config,
  resetChatwootGlobals,
  SupportStatus,
} from './chatwoot-widget.test-support';

const mocks = vi.hoisted(() => ({
  bridge: vi.fn((_props: { storeSlug: string; widgetOrigin: string }) => null),
  pathname: '/shop',
  reload: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock('./ogabassey/components/chat/chatwoot-inline-cart-bridge', () => ({
  ChatwootInlineCartBridge: (props: {
    storeSlug: string;
    widgetOrigin: string;
  }) => {
    mocks.bridge(props);
    return null;
  },
}));

vi.mock('./reload-chatwoot-tenant-document', () => ({
  reloadChatwootTenantDocument: mocks.reload,
}));

beforeEach(() => {
  mocks.pathname = '/shop';
  resetChatwootGlobals();
  mocks.bridge.mockClear();
  mocks.reload.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatwootWidget tenant switching', () => {
  it('hides the old tenant bridge during the render that switches tenant', () => {
    const reset = vi.fn();
    const toggleBubbleVisibility = vi.fn();
    const run = vi.fn(({ websiteToken, baseUrl }) => {
      (
        window as Window & {
          $chatwoot?: Record<string, unknown>;
        }
      ).$chatwoot = {
        reset,
        toggleBubbleVisibility,
        websiteToken,
        baseUrl,
      };
    });
    (window as Window & { chatwootSDK?: { run: typeof run } }).chatwootSDK = {
      run,
    };
    const view = render(
      <ChatwootWidget config={config}>
        <SupportStatus />
      </ChatwootWidget>
    );
    fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);
    fireEvent(window, new Event('chatwoot:ready'));

    expect(screen.getByTestId('support-active')).toHaveTextContent('true');

    const nextConfig = {
      ...config,
      websiteToken: 'next-public-widget-token-123',
      storeSlug: 'next-shop',
    };
    view.rerender(
      <ChatwootWidget config={nextConfig}>
        <SupportStatus />
      </ChatwootWidget>
    );

    expect(screen.getByTestId('support-active')).toHaveTextContent('false');
    expect(
      mocks.bridge.mock.calls.every(([props]) => props.storeSlug === 'shop')
    ).toBe(true);
    expect(reset).toHaveBeenCalledOnce();
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reload.mock.invocationCallOrder[0]
    );
  });

  it.each([
    '/shop/cart',
    '/shop/checkout',
    '/shop/checkout/success',
    '/cart',
    '/checkout/success',
  ])('defers tenant reloads until leaving cart and checkout paths (%s)', (pathname) => {
    const reset = vi.fn();
    const toggleBubbleVisibility = vi.fn();
    const run = vi.fn(({ websiteToken, baseUrl }) => {
      (
        window as Window & {
          $chatwoot?: Record<string, unknown>;
        }
      ).$chatwoot = {
        reset,
        toggleBubbleVisibility,
        websiteToken,
        baseUrl,
      };
    });
    (window as Window & { chatwootSDK?: { run: typeof run } }).chatwootSDK = {
      run,
    };
    const view = render(
      <ChatwootWidget config={config}>
        <SupportStatus />
      </ChatwootWidget>
    );
    fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);
    fireEvent(window, new Event('chatwoot:ready'));
    mocks.pathname = pathname;
    view.rerender(
      <ChatwootWidget
        config={{ ...config, websiteToken: 'next-public-widget-token-123' }}
      >
        <SupportStatus />
      </ChatwootWidget>
    );

    expect(screen.getByTestId('support-active')).toHaveTextContent('false');
    expect(toggleBubbleVisibility).toHaveBeenCalledWith('hide');
    // The prior conversation is closed now, but the document is not reloaded.
    expect(reset).toHaveBeenCalledOnce();
    expect(mocks.reload).not.toHaveBeenCalled();

    mocks.pathname = '/shop/product';
    view.rerender(
      <ChatwootWidget
        config={{ ...config, websiteToken: 'next-public-widget-token-123' }}
      >
        <SupportStatus />
      </ChatwootWidget>
    );

    expect(reset).toHaveBeenCalledTimes(2);
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it.each([
    { pathname: '/shop/products/cart', storeSlug: 'shop' },
    { pathname: '/checkout/products/item', storeSlug: 'checkout' },
  ])('does not defer a tenant reload for a cart or checkout slug ($pathname)', ({
    pathname,
    storeSlug,
  }) => {
    const reset = vi.fn();
    const run = vi.fn(({ websiteToken, baseUrl }) => {
      (
        window as Window & {
          $chatwoot?: Record<string, unknown>;
        }
      ).$chatwoot = { reset, websiteToken, baseUrl };
    });
    (window as Window & { chatwootSDK?: { run: typeof run } }).chatwootSDK = {
      run,
    };
    mocks.pathname = pathname;
    const view = render(
      <ChatwootWidget config={{ ...config, storeSlug }}>
        <SupportStatus />
      </ChatwootWidget>
    );
    fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);
    fireEvent(window, new Event('chatwoot:ready'));

    view.rerender(
      <ChatwootWidget
        config={{
          ...config,
          storeSlug,
          websiteToken: 'next-public-widget-token-123',
        }}
      >
        <SupportStatus />
      </ChatwootWidget>
    );

    expect(reset).toHaveBeenCalledOnce();
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it.each([
    'missing',
    'throws',
  ] as const)('does not reload into a new tenant when the prior SDK reset %s', (resetMode) => {
    const toggleBubbleVisibility = vi.fn();
    const reset =
      resetMode === 'throws'
        ? vi.fn(() => {
            throw new Error('reset failed');
          })
        : undefined;
    const run = vi.fn(({ websiteToken, baseUrl }) => {
      const widget: Record<string, unknown> = {
        websiteToken,
        baseUrl,
        toggleBubbleVisibility,
      };
      if (reset) widget.reset = reset;
      (window as Window & { $chatwoot?: Record<string, unknown> }).$chatwoot =
        widget;
    });
    (window as Window & { chatwootSDK?: { run: typeof run } }).chatwootSDK = {
      run,
    };
    const view = render(
      <ChatwootWidget config={config}>
        <SupportStatus />
      </ChatwootWidget>
    );
    fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);
    fireEvent(window, new Event('chatwoot:ready'));
    expect(screen.getByTestId('support-active')).toHaveTextContent('true');

    view.rerender(
      <ChatwootWidget
        config={{ ...config, websiteToken: 'next-public-widget-token-123' }}
      >
        <SupportStatus />
      </ChatwootWidget>
    );

    expect(screen.getByTestId('support-active')).toHaveTextContent('false');
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(toggleBubbleVisibility).toHaveBeenCalledWith('hide');
    if (reset) expect(reset).toHaveBeenCalledOnce();
    expect(
      (window as Window & { __baciChatwootConfigKey?: string })
        .__baciChatwootConfigKey
    ).toContain(config.websiteToken);
  });
});

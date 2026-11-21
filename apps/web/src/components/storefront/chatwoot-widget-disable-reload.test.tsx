// @vitest-environment-options {"url":"https://shop.example.com"}
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatwootWidget } from './chatwoot-widget';
import { config, resetChatwootGlobals } from './chatwoot-widget.test-support';

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

describe('ChatwootWidget disablement', () => {
  it('preserves the tenant key through disablement and reloads before changing tenants', () => {
    const run = vi.fn(({ websiteToken, baseUrl }) => {
      (
        window as Window & {
          $chatwoot?: { websiteToken: string; baseUrl: string };
        }
      ).$chatwoot = { websiteToken, baseUrl };
    });
    const reset = vi.fn();
    const toggleBubbleVisibility = vi.fn();
    (window as Window & { chatwootSDK?: { run: typeof run } }).chatwootSDK = {
      run,
    };

    const view = render(
      <ChatwootWidget config={config}>
        <span>storefront</span>
      </ChatwootWidget>
    );
    fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);
    const loadedChatwoot = (window as Window & { $chatwoot?: object })
      .$chatwoot;
    if (!loadedChatwoot) throw new Error('SDK run did not initialize Chatwoot');
    Object.assign(loadedChatwoot, { reset, toggleBubbleVisibility });
    fireEvent(window, new Event('chatwoot:ready'));

    view.rerender(
      <ChatwootWidget config={null}>
        <span>support disabled</span>
      </ChatwootWidget>
    );
    // bugfix: a disabled storefront must close the prior tenant's
    // conversation without reloading the document.
    expect(reset).toHaveBeenCalledTimes(1);
    expect(mocks.reload).not.toHaveBeenCalled();

    const nextConfig = {
      ...config,
      websiteToken: 'next-public-widget-token-123',
      storeSlug: 'next-shop',
    };
    view.rerender(
      <ChatwootWidget config={nextConfig}>
        <span>next storefront</span>
      </ChatwootWidget>
    );

    expect(reset).toHaveBeenCalledTimes(2);
    expect(toggleBubbleVisibility).toHaveBeenCalledWith('hide');
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });
});

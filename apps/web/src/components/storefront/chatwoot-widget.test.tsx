// @vitest-environment-options {"url":"https://shop.example.com"}
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatwootWidget, useChatwootSupportActive } from './chatwoot-widget';

const mocks = vi.hoisted(() => ({
  bridge: vi.fn((_props: { storeSlug: string; widgetOrigin: string }) => null),
  reload: vi.fn(),
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

const config = {
  platformOrigin: 'https://support.example.com',
  storefrontOrigin: 'https://shop.example.com',
  websiteToken: 'public-widget-token-123456',
  storeSlug: 'shop',
};

function SupportStatus() {
  return (
    <output data-testid="support-active">
      {String(useChatwootSupportActive())}
    </output>
  );
}

beforeEach(() => {
  delete (window as Window & { chatwootSDK?: unknown }).chatwootSDK;
  delete (window as Window & { $chatwoot?: unknown }).$chatwoot;
  delete (window as Window & { __baciChatwootRunStarted?: boolean })
    .__baciChatwootRunStarted;
  delete (window as Window & { __baciChatwootConfigKey?: string })
    .__baciChatwootConfigKey;
  delete (window as Window & { __baciChatwootReadyKey?: string })
    .__baciChatwootReadyKey;
  document.getElementById('baci-chatwoot-sdk')?.remove();
  mocks.bridge.mockClear();
  mocks.reload.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatwootWidget', () => {
  it('keeps the widget and bridge absent when no tenant binding is configured', () => {
    render(
      <ChatwootWidget config={null}>
        <span>storefront</span>
      </ChatwootWidget>
    );

    expect(screen.getByText('storefront')).toBeInTheDocument();
    expect(document.getElementById('baci-chatwoot-sdk')).toBeNull();
    expect(mocks.bridge).not.toHaveBeenCalled();
  });

  it('loads the official SDK from the fixed platform and mounts the trusted bridge', () => {
    const run = vi.fn(({ websiteToken, baseUrl }) => {
      const widgetWindow = window as Window & {
        $chatwoot?: Record<string, unknown>;
      };
      widgetWindow.$chatwoot = {
        ...widgetWindow.$chatwoot,
        websiteToken,
        baseUrl,
      };
    });
    (window as Window & { chatwootSDK?: { run: typeof run } }).chatwootSDK = {
      run,
    };

    render(
      <ChatwootWidget config={config}>
        <div>
          <span>storefront</span>
          <SupportStatus />
        </div>
      </ChatwootWidget>
    );

    const script = document.getElementById(
      'baci-chatwoot-sdk'
    ) as HTMLScriptElement;
    expect(script.src).toBe('https://support.example.com/packs/js/sdk.js');
    fireEvent.load(script);
    expect(run).toHaveBeenCalledWith({
      websiteToken: config.websiteToken,
      baseUrl: config.platformOrigin,
    });
    expect(mocks.bridge).not.toHaveBeenCalled();
    expect(screen.getByTestId('support-active')).toHaveTextContent('false');
    fireEvent(window, new Event('chatwoot:ready'));
    expect(mocks.bridge).toHaveBeenCalledWith({
      storeSlug: 'shop',
      widgetOrigin: config.platformOrigin,
    });
    expect(screen.getByTestId('support-active')).toHaveTextContent('true');
  });

  it('does not load a tenant widget on a different browser origin', () => {
    render(
      <ChatwootWidget
        config={{ ...config, storefrontOrigin: 'https://other.example.com' }}
      >
        <span>storefront</span>
      </ChatwootWidget>
    );

    expect(document.getElementById('baci-chatwoot-sdk')).toBeNull();
    expect(mocks.bridge).not.toHaveBeenCalled();
  });

  it('fails closed when an unowned SDK global already exists', () => {
    const run = vi.fn();
    (window as Window & { chatwootSDK?: { run: typeof run } }).chatwootSDK = {
      run,
    };
    (
      window as Window & {
        $chatwoot?: {
          websiteToken: string;
          baseUrl: string;
          toggleBubbleVisibility: ReturnType<typeof vi.fn>;
        };
      }
    ).$chatwoot = {
      websiteToken: 'another-widget-token-123456',
      baseUrl: config.platformOrigin,
      toggleBubbleVisibility: vi.fn(),
    };

    render(
      <ChatwootWidget config={config}>
        <SupportStatus />
      </ChatwootWidget>
    );

    expect(run).not.toHaveBeenCalled();
    expect(screen.getByTestId('support-active')).toHaveTextContent('false');
    expect(document.getElementById('baci-chatwoot-sdk')).toBeNull();
    expect(mocks.bridge).not.toHaveBeenCalled();
  });

  it('does not claim ownership when Chatwoot appears before the SDK run callback', () => {
    const run = vi.fn();
    render(
      <ChatwootWidget config={config}>
        <SupportStatus />
      </ChatwootWidget>
    );
    (window as Window & { chatwootSDK?: { run: typeof run } }).chatwootSDK = {
      run,
    };
    (
      window as Window & {
        $chatwoot?: {
          websiteToken: string;
          baseUrl: string;
          toggleBubbleVisibility: ReturnType<typeof vi.fn>;
        };
      }
    ).$chatwoot = {
      websiteToken: 'another-widget-token-123456',
      baseUrl: config.platformOrigin,
      toggleBubbleVisibility: vi.fn(),
    };

    fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);
    fireEvent(window, new Event('chatwoot:ready'));

    expect(run).not.toHaveBeenCalled();
    expect(
      (window as Window & { __baciChatwootRunStarted?: boolean })
        .__baciChatwootRunStarted
    ).toBeUndefined();
    expect(screen.getByTestId('support-active')).toHaveTextContent('false');
    expect(mocks.bridge).not.toHaveBeenCalled();
  });

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

    view.rerender(
      <ChatwootWidget config={null}>
        <span>support disabled</span>
      </ChatwootWidget>
    );
    expect(reset).not.toHaveBeenCalled();

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

    expect(reset).toHaveBeenCalledTimes(1);
    expect(toggleBubbleVisibility).toHaveBeenCalledWith('hide');
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });
});

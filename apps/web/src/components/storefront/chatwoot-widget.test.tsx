// @vitest-environment-options {"url":"https://shop.example.com"}
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatwootWidget } from './chatwoot-widget';
import {
  config,
  resetChatwootGlobals,
  SupportStatus,
} from './chatwoot-widget.test-support';

const mocks = vi.hoisted(() => ({
  bridge: vi.fn(
    (_props: {
      storeSlug: string;
      widgetOrigin: string;
      checkoutEnabled?: boolean;
    }) => null
  ),
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
    checkoutEnabled?: boolean;
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

describe('ChatwootWidget', () => {
  it('preserves Chatwoot settings configured before the widget mounts', () => {
    const settings = { locale: 'en', position: 'left' };
    (
      window as Window & { chatwootSettings?: Record<string, unknown> }
    ).chatwootSettings = settings;

    render(
      <ChatwootWidget config={config}>
        <span>storefront</span>
      </ChatwootWidget>
    );

    expect(
      (window as Window & { chatwootSettings?: Record<string, unknown> })
        .chatwootSettings
    ).toBe(settings);
  });

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
      checkoutEnabled: false,
    });
    expect(screen.getByTestId('support-active')).toHaveTextContent('true');
  });

  it('waits for an asynchronously initialized SDK global before accepting ready', async () => {
    const run = vi.fn(({ websiteToken, baseUrl }) => {
      const widget: { websiteToken?: string; baseUrl?: string } = {};
      (window as Window & { $chatwoot?: typeof widget }).$chatwoot = widget;
      queueMicrotask(() => {
        Object.assign(widget, { websiteToken, baseUrl });
      });
    });
    (window as Window & { chatwootSDK?: { run: typeof run } }).chatwootSDK = {
      run,
    };

    render(
      <ChatwootWidget config={config}>
        <SupportStatus />
      </ChatwootWidget>
    );
    fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);

    expect(run).toHaveBeenCalledOnce();
    expect(
      (window as Window & { __baciChatwootRunStarted?: boolean })
        .__baciChatwootRunStarted
    ).toBe(true);
    expect(screen.getByTestId('support-active')).toHaveTextContent('false');
    await waitFor(() => {
      expect(
        (window as Window & { $chatwoot?: { websiteToken?: string } }).$chatwoot
          ?.websiteToken
      ).toBe(config.websiteToken);
    });

    fireEvent(window, new Event('chatwoot:ready'));

    expect(screen.getByTestId('support-active')).toHaveTextContent('true');
    expect(mocks.bridge).toHaveBeenCalledWith({
      storeSlug: config.storeSlug,
      widgetOrigin: config.platformOrigin,
      checkoutEnabled: false,
    });
  });

  it('passes the server checkout flag to the bridge only when it is exactly true', () => {
    const run = vi.fn(({ websiteToken, baseUrl }) => {
      (window as Window & { $chatwoot?: Record<string, unknown> }).$chatwoot = {
        websiteToken,
        baseUrl,
      };
    });
    (window as Window & { chatwootSDK?: { run: typeof run } }).chatwootSDK = {
      run,
    };

    render(
      <ChatwootWidget config={{ ...config, checkoutEnabled: true }}>
        <span>storefront</span>
      </ChatwootWidget>
    );
    fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);
    fireEvent(window, new Event('chatwoot:ready'));

    expect(mocks.bridge).toHaveBeenCalledWith({
      storeSlug: 'shop',
      widgetOrigin: config.platformOrigin,
      checkoutEnabled: true,
    });
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
});

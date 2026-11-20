// @vitest-environment-options {"url":"https://shop.example.com"}
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatwootWidget, useChatwootSupportActive } from './chatwoot-widget';

const mocks = vi.hoisted(() => ({
  bridgeMounts: [] as string[],
  bridgeUnmounts: [] as string[],
  outgoingContext: [] as string[],
  pathname: '/shop',
  reload: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock('./ogabassey/components/chat/chatwoot-inline-cart-bridge', async () => {
  const { useEffect } = await import('react');
  return {
    ChatwootInlineCartBridge: ({ storeSlug }: { storeSlug: string }) => {
      useEffect(() => {
        const onMessage = (event: MessageEvent) => {
          if (event.data === 'baci-commerce-context-request') {
            mocks.outgoingContext.push(storeSlug);
          }
        };
        window.addEventListener('message', onMessage);
        mocks.bridgeMounts.push(storeSlug);
        return () => {
          window.removeEventListener('message', onMessage);
          mocks.bridgeUnmounts.push(storeSlug);
        };
      }, [storeSlug]);
      return null;
    },
  };
});

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
  mocks.pathname = '/shop';
  mocks.bridgeMounts.length = 0;
  mocks.bridgeUnmounts.length = 0;
  mocks.outgoingContext.length = 0;
  mocks.reload.mockClear();
  delete (window as Window & { chatwootSDK?: unknown }).chatwootSDK;
  delete (window as Window & { $chatwoot?: unknown }).$chatwoot;
  delete (window as Window & { __baciChatwootRunStarted?: boolean })
    .__baciChatwootRunStarted;
  delete (window as Window & { __baciChatwootConfigKey?: string })
    .__baciChatwootConfigKey;
  delete (window as Window & { __baciChatwootReadyKey?: string })
    .__baciChatwootReadyKey;
  delete (window as Window & { __baciChatwootContainedKey?: string })
    .__baciChatwootContainedKey;
  delete (window as Window & { __baciChatwootPendingContainKey?: string })
    .__baciChatwootPendingContainKey;
  document.getElementById('baci-chatwoot-sdk')?.remove();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatwootWidget checkout tenant isolation', () => {
  it('hides the prior widget and unmounts its context bridge until checkout ends', async () => {
    const reset = vi.fn();
    const toggleBubbleVisibility = vi.fn();
    const run = vi.fn(({ websiteToken, baseUrl }) => {
      (window as Window & { $chatwoot?: Record<string, unknown> }).$chatwoot = {
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
    await waitFor(() => expect(mocks.bridgeMounts).toEqual(['shop']));

    mocks.outgoingContext.length = 0;
    mocks.pathname = '/shop/checkout';
    view.rerender(
      <ChatwootWidget
        config={{ ...config, websiteToken: 'next-public-widget-token-123' }}
      >
        <SupportStatus />
      </ChatwootWidget>
    );

    expect(toggleBubbleVisibility).toHaveBeenCalledWith('hide');
    expect(screen.getByTestId('support-active')).toHaveTextContent('false');
    // bugfix: the prior conversation is closed (SDK reset, no document
    // reload) exactly once, even across further checkout navigations.
    expect(reset).toHaveBeenCalledTimes(1);
    expect(mocks.reload).not.toHaveBeenCalled();
    mocks.pathname = '/shop/checkout/payment';
    view.rerender(
      <ChatwootWidget
        config={{ ...config, websiteToken: 'next-public-widget-token-123' }}
      >
        <SupportStatus />
      </ChatwootWidget>
    );
    expect(reset).toHaveBeenCalledTimes(1);
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(mocks.bridgeMounts).toEqual(['shop']);
    expect(mocks.bridgeUnmounts).toEqual(['shop']);

    window.dispatchEvent(
      new MessageEvent('message', { data: 'baci-commerce-context-request' })
    );
    expect(mocks.outgoingContext).toEqual([]);
  });

  it('does not reset a widget that is still initialising when a deferred switch starts', () => {
    const reset = vi.fn();
    const run = vi.fn(({ websiteToken, baseUrl }) => {
      (window as Window & { $chatwoot?: Record<string, unknown> }).$chatwoot = {
        reset,
        toggleBubbleVisibility: vi.fn(),
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

    mocks.pathname = '/shop/checkout';
    view.rerender(
      <ChatwootWidget
        config={{ ...config, websiteToken: 'next-public-widget-token-123' }}
      >
        <SupportStatus />
      </ChatwootWidget>
    );

    expect(reset).not.toHaveBeenCalled();
  });

  it('contains a widget that finishes loading while another tenant is deferred', () => {
    const reset = vi.fn();
    const toggle = vi.fn();
    let ready = false;
    const run = vi.fn(({ websiteToken, baseUrl }) => {
      (window as Window & { $chatwoot?: Record<string, unknown> }).$chatwoot = {
        reset,
        toggleBubbleVisibility: (v: string) => {
          if (!ready) throw new TypeError('bubble holder missing');
          toggle(v);
        },
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

    mocks.pathname = '/shop/checkout';
    expect(() =>
      view.rerender(
        <ChatwootWidget
          config={{ ...config, websiteToken: 'next-public-widget-token-123' }}
        >
          <SupportStatus />
        </ChatwootWidget>
      )
    ).not.toThrow();

    ready = true;
    fireEvent(window, new Event('chatwoot:ready'));

    expect(reset).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenLastCalledWith('hide');
    expect(screen.getByTestId('support-active')).toHaveTextContent('false');
  });

  it('closes the conversation when the storefront wrapper unmounts', () => {
    const reset = vi.fn();
    const toggle = vi.fn();
    const run = vi.fn(({ websiteToken, baseUrl }) => {
      (window as Window & { $chatwoot?: Record<string, unknown> }).$chatwoot = {
        reset,
        toggleBubbleVisibility: toggle,
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

    view.unmount();

    expect(reset).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenLastCalledWith('hide');
    expect(mocks.reload).not.toHaveBeenCalled();
  });
});

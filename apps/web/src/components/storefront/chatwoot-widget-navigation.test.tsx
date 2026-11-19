// @vitest-environment-options {"url":"https://shop.example.com"}
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatwootWidget, useChatwootSupportActive } from './chatwoot-widget';

const mocks = vi.hoisted(() => ({ pathname: '/shop' }));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock('./ogabassey/components/chat/chatwoot-inline-cart-bridge', () => ({
  ChatwootInlineCartBridge: () => null,
}));

vi.mock('./reload-chatwoot-tenant-document', () => ({
  reloadChatwootTenantDocument: vi.fn(),
}));

type TestWindow = Window & {
  chatwootSDK?: { run: (o: { websiteToken: string; baseUrl: string }) => void };
  $chatwoot?: Record<string, unknown>;
  __baciChatwootRunStarted?: boolean;
  __baciChatwootConfigKey?: string;
  __baciChatwootReadyKey?: string;
};

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
  const w = window as TestWindow;
  delete w.chatwootSDK;
  delete w.$chatwoot;
  delete w.__baciChatwootRunStarted;
  delete w.__baciChatwootConfigKey;
  delete w.__baciChatwootReadyKey;
  document.getElementById('baci-chatwoot-sdk')?.remove();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatwootWidget navigation during initialisation', () => {
  it('shows the bubble on ready after a route change hid it mid-initialisation', () => {
    const toggle = vi.fn();
    const w = window as TestWindow;
    w.chatwootSDK = {
      run: ({ websiteToken, baseUrl }) => {
        w.$chatwoot = {
          websiteToken,
          baseUrl,
          toggleBubbleVisibility: toggle,
        };
      },
    };

    const tree = () => (
      <ChatwootWidget config={config}>
        <SupportStatus />
      </ChatwootWidget>
    );
    const { rerender } = render(tree());
    fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);
    expect(w.__baciChatwootReadyKey).toBeUndefined();

    // Shopper navigates before chatwoot:ready: cleanup hides the bubble.
    mocks.pathname = '/shop/products';
    rerender(tree());
    expect(toggle).toHaveBeenLastCalledWith('hide');
    expect(w.__baciChatwootReadyKey).toBeUndefined();

    fireEvent(window, new Event('chatwoot:ready'));

    expect(toggle).toHaveBeenLastCalledWith('show');
    expect(screen.getByTestId('support-active')).toHaveTextContent('true');
  });

  it('does not throw from cleanup when the SDK visibility call fails before its bubble exists', () => {
    const w = window as TestWindow;
    const toggle = vi.fn(() => {
      throw new TypeError('bubble holder missing');
    });
    w.chatwootSDK = {
      run: ({ websiteToken, baseUrl }) => {
        w.$chatwoot = {
          websiteToken,
          baseUrl,
          toggleBubbleVisibility: toggle,
        };
      },
    };
    const tree = () => (
      <ChatwootWidget config={config}>
        <SupportStatus />
      </ChatwootWidget>
    );
    const { rerender } = render(tree());
    fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);

    mocks.pathname = '/shop/products';
    expect(() => rerender(tree())).not.toThrow();
    expect(toggle).toHaveBeenCalledWith('hide');
  });
});

// @vitest-environment-options {"url":"https://shop.example.com"}
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHATWOOT_LAUNCHER_OVERLAY_CSS } from './chatwoot-launcher-overlay-style';
import { ChatwootWidget } from './chatwoot-widget';
import {
  config,
  resetChatwootGlobals,
  SupportStatus,
} from './chatwoot-widget.test-support';

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

type SdkWindow = Window & {
  chatwootSDK?: { run: (o: { websiteToken: string; baseUrl: string }) => void };
  $chatwoot?: Record<string, unknown>;
};

const overlayStyle = () =>
  document.querySelector('style[data-href="chatwoot-launcher-overlays"]');

function startWidget() {
  const w = window as SdkWindow;
  w.chatwootSDK = {
    run: ({ websiteToken, baseUrl }) => {
      w.$chatwoot = {
        websiteToken,
        baseUrl,
        toggleBubbleVisibility: vi.fn(),
      };
    },
  };
  render(
    <ChatwootWidget config={config}>
      <SupportStatus />
    </ChatwootWidget>
  );
  fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);
}

beforeEach(() => {
  mocks.pathname = '/shop';
  resetChatwootGlobals();
});

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('style[data-href]').forEach((el) => {
    el.remove();
  });
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ChatwootWidget launcher overlays', () => {
  it('adds nothing before the widget is ready', () => {
    startWidget();

    expect(screen.getByTestId('support-active')).toHaveTextContent('false');
    expect(overlayStyle()).toBeNull();
  });

  it('yields to the consent prompt and filter drawer once the widget is ready', () => {
    startWidget();
    fireEvent(window, new Event('chatwoot:ready'));

    expect(screen.getByTestId('support-active')).toHaveTextContent('true');
    expect(overlayStyle()).toHaveTextContent(CHATWOOT_LAUNCHER_OVERLAY_CSS);
  });
});

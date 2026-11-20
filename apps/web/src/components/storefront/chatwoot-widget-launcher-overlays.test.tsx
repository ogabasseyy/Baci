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
import { CHATWOOT_BUBBLE_CLEARANCE_PROPERTY } from './use-chatwoot-launcher-clearance';

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

const clearance = () =>
  document.documentElement.style.getPropertyValue(
    CHATWOOT_BUBBLE_CLEARANCE_PROPERTY
  );

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
  const tree = () => (
    <ChatwootWidget config={config}>
      <SupportStatus />
    </ChatwootWidget>
  );
  const view = render(tree());
  fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);
  return { ...view, tree };
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
  document.documentElement.style.removeProperty(
    CHATWOOT_BUBBLE_CLEARANCE_PROPERTY
  );
  vi.restoreAllMocks();
});

describe('ChatwootWidget launcher overlays', () => {
  it('adds nothing before the widget is ready', () => {
    mocks.pathname = '/shop/cart';
    startWidget();

    expect(screen.getByTestId('support-active')).toHaveTextContent('false');
    expect(overlayStyle()).toBeNull();
    expect(clearance()).toBe('');
  });

  it('yields to the consent prompt and filter drawer once the widget is ready', () => {
    startWidget();
    fireEvent(window, new Event('chatwoot:ready'));

    expect(screen.getByTestId('support-active')).toHaveTextContent('true');
    expect(overlayStyle()).toHaveTextContent(CHATWOOT_LAUNCHER_OVERLAY_CSS);
  });

  it('lifts the launcher on the cart page and drops it elsewhere', () => {
    mocks.pathname = '/shop/cart';
    const { rerender, tree } = startWidget();
    fireEvent(window, new Event('chatwoot:ready'));
    expect(clearance()).toBe('5.5rem');

    mocks.pathname = '/shop/products';
    rerender(tree());
    expect(clearance()).toBe('');
  });
});

describe('launcher overlay CSS', () => {
  it('hides only the closed-state launcher, never the close button', () => {
    expect(CHATWOOT_LAUNCHER_OVERLAY_CSS).toContain(
      '.woot-widget-bubble:not(.woot--close)'
    );
  });

  it('covers both the consent prompt and the filter drawer', () => {
    expect(CHATWOOT_LAUNCHER_OVERLAY_CSS).toContain(
      '[data-storefront-cookie-consent]'
    );
    expect(CHATWOOT_LAUNCHER_OVERLAY_CSS).toContain(
      '[data-storefront-filter-drawer]'
    );
  });

  it('keeps a keyboard-focused launcher visible and reachable', () => {
    expect(CHATWOOT_LAUNCHER_OVERLAY_CSS).toContain(':not(:focus-visible)');
    expect(CHATWOOT_LAUNCHER_OVERLAY_CSS).not.toContain('display:none');
    expect(CHATWOOT_LAUNCHER_OVERLAY_CSS).not.toContain('visibility:hidden');
  });

  it('matches what the markup the SDK builds would expose', () => {
    document.body.innerHTML = `
      <div data-storefront-cookie-consent></div>
      <div class="woot--bubble-holder">
        <button class="woot-widget-bubble" id="open"></button>
        <button class="woot-widget-bubble woot--close" id="close"></button>
      </div>`;
    const selector = CHATWOOT_LAUNCHER_OVERLAY_CSS.slice(
      0,
      CHATWOOT_LAUNCHER_OVERLAY_CSS.indexOf('{')
    );
    const matched = [...document.querySelectorAll(selector)].map((el) => el.id);

    expect(matched).toEqual(['open']);
    document.body.innerHTML = '';
  });
});

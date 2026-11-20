// @vitest-environment-options {"url":"https://shop.example.com"}
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHATWOOT_CONSENT_OVERLAY_CSS,
  CHATWOOT_FILTER_DRAWER_OVERLAY_CSS,
  CHATWOOT_LAUNCHER_OVERLAY_CSS,
} from './chatwoot-launcher-overlay-style';
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

describe('launcher overlay CSS', () => {
  const LAUNCHER_MARKUP = `
    <div class="woot--bubble-holder">
      <button class="woot-widget-bubble" id="open"></button>
      <button class="woot-widget-bubble woot--close" id="close"></button>
    </div>`;

  const matches = (rule: string) => {
    const selector = rule.slice(0, rule.indexOf('{'));
    return [...document.querySelectorAll(selector)].map((el) => el.id);
  };

  it('hides only the closed-state launcher, never the close button', () => {
    document.body.innerHTML = `<div data-storefront-cookie-consent></div><div data-storefront-filter-drawer></div>${LAUNCHER_MARKUP}`;

    expect(matches(CHATWOOT_CONSENT_OVERLAY_CSS)).toEqual(['open']);
    expect(matches(CHATWOOT_FILTER_DRAWER_OVERLAY_CSS)).toEqual(['open']);
  });

  it('keeps a focused launcher visible, however it got focus', () => {
    document.body.innerHTML = `<div data-storefront-cookie-consent></div>${LAUNCHER_MARKUP}`;
    (document.getElementById('open') as HTMLElement).focus();

    expect(matches(CHATWOOT_CONSENT_OVERLAY_CSS)).toEqual([]);
  });

  it('does nothing without the consent prompt or the drawer', () => {
    document.body.innerHTML = LAUNCHER_MARKUP;

    expect(matches(CHATWOOT_CONSENT_OVERLAY_CSS)).toEqual([]);
    expect(matches(CHATWOOT_FILTER_DRAWER_OVERLAY_CSS)).toEqual([]);
  });

  it('keeps the non-modal consent launcher reachable by keyboard', () => {
    expect(CHATWOOT_CONSENT_OVERLAY_CSS).toContain(':not(:focus)');
    expect(CHATWOOT_CONSENT_OVERLAY_CSS).not.toContain('focus-visible');
    expect(CHATWOOT_CONSENT_OVERLAY_CSS).toContain(
      '{opacity:0;pointer-events:none}'
    );
    expect(CHATWOOT_CONSENT_OVERLAY_CSS).not.toContain('visibility:hidden');
  });

  it('removes the launcher from the tab order behind the modal filter drawer', () => {
    expect(CHATWOOT_FILTER_DRAWER_OVERLAY_CSS).toContain('{visibility:hidden}');
    // No focus exception: focus must not escape the modal drawer.
    expect(CHATWOOT_FILTER_DRAWER_OVERLAY_CSS).not.toContain('focus');
    expect(CHATWOOT_CONSENT_OVERLAY_CSS).not.toContain(
      'data-storefront-filter-drawer'
    );
  });
});

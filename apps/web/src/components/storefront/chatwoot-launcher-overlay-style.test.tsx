import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHATWOOT_CONSENT_OVERLAY_CSS,
  CHATWOOT_FILTER_DRAWER_OVERLAY_CSS,
  CHATWOOT_LAUNCHER_OVERLAY_CSS,
  ChatwootLauncherOverlayStyle,
} from './chatwoot-launcher-overlay-style';

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('style[data-href]').forEach((el) => {
    el.remove();
  });
  document.body.innerHTML = '';
});

describe('ChatwootLauncherOverlayStyle', () => {
  it('renders both rules as one hoisted stylesheet', () => {
    render(<ChatwootLauncherOverlayStyle />);

    const style = document.querySelector(
      'style[data-href="chatwoot-launcher-overlays"]'
    );
    expect(style).toHaveTextContent(CHATWOOT_CONSENT_OVERLAY_CSS);
    expect(style).toHaveTextContent(CHATWOOT_FILTER_DRAWER_OVERLAY_CSS);
    expect(CHATWOOT_LAUNCHER_OVERLAY_CSS).toBe(
      `${CHATWOOT_CONSENT_OVERLAY_CSS}${CHATWOOT_FILTER_DRAWER_OVERLAY_CSS}`
    );
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

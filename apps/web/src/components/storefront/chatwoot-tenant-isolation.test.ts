// @vitest-environment-options {"url":"https://shop.example.com"}
import { afterEach, describe, expect, it } from 'vitest';
import { installChatwootMessageGuard } from './chatwoot-inbound-message-guard';
import {
  clearChatwootCookies,
  reconcileChatwootTenant,
  sealChatwootWidget,
} from './chatwoot-tenant-isolation';

function setCookie(name: string, value = 'v') {
  document.cookie = `${name}=${value}; path=/`;
}

afterEach(() => {
  clearChatwootCookies();
  document.cookie = 'unrelated=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  (window as Window & { __baciChatwootSealed?: boolean }).__baciChatwootSealed =
    undefined;
});

describe('bugfix: previous tenant cookie survived into the next tenant document', () => {
  it('clears only Chatwoot SDK cookies', () => {
    setCookie('cw_conversation');
    setCookie('cw_user_public-token-123456');
    setCookie('cw_snooze_campaigns_till');
    setCookie('unrelated');

    clearChatwootCookies();

    expect(document.cookie).toBe('unrelated=v');
  });

  it('removes the reloading widget iframe so it cannot post a loaded message', () => {
    document.body.innerHTML =
      '<div class="woot-widget-holder"><iframe id="chatwoot_live_chat_widget"></iframe></div><div class="woot--bubble-holder"></div><p id="keep"></p>';
    setCookie('cw_conversation');

    sealChatwootWidget(window);

    expect(document.getElementById('chatwoot_live_chat_widget')).toBeNull();
    expect(document.querySelector('.woot-widget-holder')).toBeNull();
    expect(document.querySelector('.woot--bubble-holder')).toBeNull();
    expect(document.getElementById('keep')).not.toBeNull();
    expect(document.cookie).not.toContain('cw_conversation');
  });

  it('drops queued widget messages from the platform origin once sealed', () => {
    installChatwootMessageGuard('https://support.example.com');
    const received: string[] = [];
    const handler = (event: MessageEvent) => received.push(String(event.data));
    window.addEventListener('message', handler);
    const loaded = 'chatwoot-widget:{"event":"loaded"}';
    const post = () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: loaded,
          origin: 'https://support.example.com',
        })
      );

    post();
    expect(received).toEqual([loaded]);

    sealChatwootWidget(window);
    post();
    expect(received).toEqual([loaded]);
    window.removeEventListener('message', handler);
  });

  it('clears leftover cookies when the session last ran another tenant', () => {
    reconcileChatwootTenant('tenant-a');
    setCookie('cw_conversation');
    reconcileChatwootTenant('tenant-a');
    expect(document.cookie).toContain('cw_conversation');

    reconcileChatwootTenant('tenant-b');
    expect(document.cookie).not.toContain('cw_conversation');
    expect(window.sessionStorage.getItem('baci-chatwoot-last-tenant')).toBe(
      'tenant-b'
    );
  });
});

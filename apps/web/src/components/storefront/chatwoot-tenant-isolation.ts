type SealableWindow = Window & { __baciChatwootSealed?: boolean };

// Cookie names written by Chatwoot Web SDK v4.19.1 (sdk.js): the conversation
// token, one per-inbox user token, and the campaign snooze marker.
const CHATWOOT_COOKIE_PATTERN =
  /^(cw_conversation|cw_user_.+|cw_snooze_campaigns_till)$/;
const LAST_TENANT_STORAGE_KEY = 'baci-chatwoot-last-tenant';
const WIDGET_ELEMENT_SELECTOR =
  '#chatwoot_live_chat_widget, .woot-widget-holder, .woot--bubble-holder';

/** Expires every Chatwoot SDK cookie readable by this document. */
export function clearChatwootCookies(): void {
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim();
    if (name && CHATWOOT_COOKIE_PATTERN.test(name)) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  }
}

/**
 * Makes the previous tenant's widget inert right after `$chatwoot.reset()`.
 * reset() deletes the cookies and starts reloading the SDK iframe, whose
 * `loaded` message would write a new conversation cookie while this document is
 * still alive. Removing the iframe and holders stops that message at the
 * source; the seal flag makes the inbound guard drop anything already queued.
 * Not timing dependent: it holds however long the next navigation takes.
 */
export function sealChatwootWidget(widgetWindow: Window): void {
  (widgetWindow as SealableWindow).__baciChatwootSealed = true;
  for (const element of document.querySelectorAll(WIDGET_ELEMENT_SELECTOR)) {
    element.remove();
  }
  clearChatwootCookies();
}

export function isChatwootWidgetSealed(widgetWindow: Window): boolean {
  return (widgetWindow as SealableWindow).__baciChatwootSealed === true;
}

/**
 * Defence in depth for the next document: if this session last ran a different
 * tenant's widget, drop any Chatwoot cookie before the SDK can read it.
 */
export function reconcileChatwootTenant(configKey: string): void {
  try {
    const previous = window.sessionStorage.getItem(LAST_TENANT_STORAGE_KEY);
    if (previous && previous !== configKey) clearChatwootCookies();
    window.sessionStorage.setItem(LAST_TENANT_STORAGE_KEY, configKey);
  } catch {
    // Storage can be blocked; the seal above is the primary protection.
  }
}

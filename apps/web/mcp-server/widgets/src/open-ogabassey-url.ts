import { widgetHost } from './widget-host';
// Opens an Ogabassey URL from the widget: the ChatGPT host bridge when
// available, otherwise a synchronously-reserved tab (popup blockers honor
// only those) or a fresh tab. Returns false for a known failed request;
// browser popup outcomes can be indeterminate with noopener.
export function openOgabasseyUrl(
  url: string,
  pendingTab?: Window | null
): boolean {
  if (widgetHost.get()?.openExternal) {
    const result = widgetHost.get()?.openExternal?.({ href: url }) as unknown;
    // A retained legacy bridge may reject asynchronously; surface the denial
    // instead of letting it escape as an unhandled rejection the caller
    // counts as success. Adapters that catch internally never reach the catch.
    if (typeof (result as Promise<void> | undefined)?.catch === 'function') {
      (result as Promise<void>).catch(() => {
        widgetHost.update({
          hostError:
            'Could not open Ogabassey. Please try again or continue in the conversation.',
        });
      });
    }
    return true;
  } else if (pendingTab && !pendingTab.closed) {
    pendingTab.location.href = url;
    return true;
  } else if (pendingTab !== undefined) {
    // An explicit reservation failed or was closed. This async path no longer
    // has a user gesture, so a fresh popup cannot recover it reliably.
    return false;
  } else {
    // Explicit noopener: unlike <a target=_blank>, window.open does not
    // imply it, and the opened page would otherwise keep a live opener
    // handle usable for reverse tabnabbing if a URL bug ever sneaks in.
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      // noopener deliberately returns null even if the browser opens a tab.
      return true;
    } catch {
      return false;
    }
  }
}

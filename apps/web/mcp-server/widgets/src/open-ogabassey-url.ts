// Opens an Ogabassey URL from the widget: the ChatGPT host bridge when
// available, otherwise a synchronously-reserved tab (popup blockers honor
// only those) or a fresh tab. Returns false when navigation was blocked.
export function openOgabasseyUrl(
  url: string,
  pendingTab?: Window | null
): boolean {
  if (window.openai?.openExternal) {
    window.openai.openExternal({ href: url });
    return true;
  } else if (pendingTab && !pendingTab.closed) {
    pendingTab.location.href = url;
    return true;
  } else {
    return window.open(url, '_blank') !== null;
  }
}

type ContainableWidgetWindow = Window & {
  $chatwoot?: {
    reset?: () => void;
    toggleBubbleVisibility?: (visibility: 'show' | 'hide') => void;
  };
  __baciChatwootConfigKey?: string;
  __baciChatwootReadyKey?: string;
  __baciChatwootContainedKey?: string;
  __baciChatwootPendingContainKey?: string;
};

/**
 * Hide-only paths must still close the previous tenant's conversation.
 * reset() clears its cookies and reloads only the SDK iframe, never this
 * document, so checkout state survives. Runs once per tenant key.
 */
export function containPreviousChatwootTenant(
  widgetWindow: ContainableWidgetWindow
): void {
  const previous = widgetWindow.$chatwoot;
  const key = widgetWindow.__baciChatwootConfigKey;
  // A widget still initialising has no conversation yet; resetting it would
  // suppress its ready event and strand the tenant on return.
  const ready = Boolean(key) && widgetWindow.__baciChatwootReadyKey === key;
  if (ready && widgetWindow.__baciChatwootContainedKey !== key) {
    try {
      previous?.reset?.();
      widgetWindow.__baciChatwootContainedKey = key;
    } catch {
      // Retry on the next navigation; the bubble is still hidden below.
    }
  }
  try {
    previous?.toggleBubbleVisibility?.('hide');
  } catch {
    // The SDK throws before its bubble holder exists; nothing to hide.
  }
  if (key && !ready && widgetWindow.__baciChatwootPendingContainKey !== key) {
    // The pending widget will show its bubble once it loads. Contain it then,
    // unless its tenant became current again in the meantime.
    widgetWindow.__baciChatwootPendingContainKey = key;
    window.addEventListener(
      'chatwoot:ready',
      () => {
        if (widgetWindow.__baciChatwootPendingContainKey !== key) return;
        widgetWindow.__baciChatwootPendingContainKey = undefined;
        widgetWindow.__baciChatwootReadyKey = key;
        containPreviousChatwootTenant(widgetWindow);
      },
      { once: true }
    );
  }
}

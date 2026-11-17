const SDK_MESSAGE_PREFIX = 'chatwoot-widget:';

type GuardedWindow = Window & {
  __baciChatwootMessageGuardOrigin?: string;
  __baciChatwootSealed?: boolean;
};

/**
 * Chatwoot's SDK dispatches `chatwoot-widget:` window messages without
 * checking their origin, and one of them writes the conversation cookie. This
 * capture listener, installed before the SDK's own, drops those messages unless
 * they come from the configured platform origin, and all of them once the widget
 * is sealed for a tenant reload. Installed once per document.
 */
export function installChatwootMessageGuard(platformOrigin: string): void {
  const guarded = window as GuardedWindow;
  if (guarded.__baciChatwootMessageGuardOrigin) return;
  guarded.__baciChatwootMessageGuardOrigin = platformOrigin;
  window.addEventListener(
    'message',
    (event) => {
      if (
        typeof event.data === 'string' &&
        event.data.startsWith(SDK_MESSAGE_PREFIX) &&
        (guarded.__baciChatwootSealed === true ||
          event.origin !== guarded.__baciChatwootMessageGuardOrigin)
      ) {
        event.stopImmediatePropagation();
      }
    },
    true
  );
}

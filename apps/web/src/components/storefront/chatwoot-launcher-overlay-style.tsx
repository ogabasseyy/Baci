/**
 * Keeps the Chatwoot launcher from covering storefront overlays the page owns.
 *
 * The native launcher hid itself behind the cookie prompt and the filter drawer
 * through storefront-chat.css, which does not load while Chatwoot is active
 * (the native launcher is not rendered then). The Chatwoot bubble sits at
 * z-index 2147483000, so without this rule it covers the consent buttons.
 *
 * Only the closed-state launcher yields: the close button and the open chat
 * stay usable. A keyboard-focused launcher stays visible, because the prompt
 * is non-modal and Tab must never land on something invisible.
 */
export const CHATWOOT_LAUNCHER_OVERLAY_CSS =
  ':root:has([data-storefront-cookie-consent],[data-storefront-filter-drawer]) ' +
  '.woot--bubble-holder .woot-widget-bubble:not(.woot--close):not(:focus-visible)' +
  '{opacity:0;pointer-events:none}';

export function ChatwootLauncherOverlayStyle() {
  return (
    <style href="chatwoot-launcher-overlays" precedence="default">
      {CHATWOOT_LAUNCHER_OVERLAY_CSS}
    </style>
  );
}

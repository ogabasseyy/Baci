/**
 * Keeps the Chatwoot launcher from covering storefront overlays the page owns.
 *
 * The native launcher hid itself behind the cookie prompt and the filter drawer
 * through storefront-chat.css, which does not load while Chatwoot is active
 * (the native launcher is not rendered then). The Chatwoot bubble sits at
 * z-index 2147483000, so without these rules it covers the consent buttons.
 *
 * The class names are the Chatwoot SDK's own (`.woot--bubble-holder`,
 * `.woot-widget-bubble`, `.woot--close`), as served by the production
 * sdk.js; chatwoot-tenant-isolation.ts already selects `.woot--bubble-holder`.
 * Only the closed-state launcher yields: the close button and the open chat
 * stay usable.
 */
const LAUNCHER = '.woot--bubble-holder .woot-widget-bubble:not(.woot--close)';

/**
 * The cookie prompt is non-modal: the launcher turns invisible and
 * unclickable, but keyboard focus still reveals it, because Tab must never
 * land on something invisible.
 */
export const CHATWOOT_CONSENT_OVERLAY_CSS =
  `:root:has([data-storefront-cookie-consent]) ${LAUNCHER}:not(:focus-visible)` +
  '{opacity:0;pointer-events:none}';

/**
 * The filter drawer is a modal dialog: nothing behind it may take focus, so
 * the launcher leaves the tab order too.
 */
export const CHATWOOT_FILTER_DRAWER_OVERLAY_CSS =
  `:root:has([data-storefront-filter-drawer]) ${LAUNCHER}` +
  '{visibility:hidden}';

export const CHATWOOT_LAUNCHER_OVERLAY_CSS = `${CHATWOOT_CONSENT_OVERLAY_CSS}${CHATWOOT_FILTER_DRAWER_OVERLAY_CSS}`;

export function ChatwootLauncherOverlayStyle() {
  return (
    <style href="chatwoot-launcher-overlays" precedence="default">
      {CHATWOOT_LAUNCHER_OVERLAY_CSS}
    </style>
  );
}

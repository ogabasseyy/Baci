import { OGABASSEY_DARK_TOKENS } from '@/components/storefront/ogabassey/dark-mode-tokens';

const DARK_BG = OGABASSEY_DARK_TOKENS.background.toLowerCase();
const DARK_FG = OGABASSEY_DARK_TOKENS.foreground.toLowerCase();
const DARK_CARD = OGABASSEY_DARK_TOKENS.card.toLowerCase();
const DARK_CARD_FG = OGABASSEY_DARK_TOKENS.cardForeground.toLowerCase();
const DARK_MUTED = OGABASSEY_DARK_TOKENS.muted.toLowerCase();
const DARK_MUTED_FG = OGABASSEY_DARK_TOKENS.mutedForeground.toLowerCase();
const DARK_BORDER = OGABASSEY_DARK_TOKENS.border.toLowerCase();
const DARK_PRIMARY = OGABASSEY_DARK_TOKENS.primary.toLowerCase();
const DARK_PRIMARY_FG = OGABASSEY_DARK_TOKENS.primaryForeground.toLowerCase();
const DARK_SECONDARY = OGABASSEY_DARK_TOKENS.secondary.toLowerCase();
const DARK_SECONDARY_FG =
  OGABASSEY_DARK_TOKENS.secondaryForeground.toLowerCase();
const DARK_ACCENT = OGABASSEY_DARK_TOKENS.accent.toLowerCase();
const DARK_ACCENT_FG = OGABASSEY_DARK_TOKENS.accentForeground.toLowerCase();
const DARK_PRICE = OGABASSEY_DARK_TOKENS.price.toLowerCase();
const DARK_RATING = OGABASSEY_DARK_TOKENS.rating.toLowerCase();
const DARK_SUCCESS = OGABASSEY_DARK_TOKENS.success.toLowerCase();
const DARK_WARNING = OGABASSEY_DARK_TOKENS.warning.toLowerCase();
const DARK_ERROR = OGABASSEY_DARK_TOKENS.error.toLowerCase();

/**
 * First-paint dark-mode custom property overrides for OgaBassey routes.
 *
 * `storefront-core.css` (which imports `storefront-ogabassey-dark-mode-tokens.css`)
 * is deferred to client-side `useEffect` loaders so Slow-4G LCP is not blocked
 * by external stylesheet requests. Without these token overrides in the inline
 * `<style precedence="high">` sheet, `var(--store-background, #ffffff)` and
 * `var(--store-secondary, #f3f4f6)` flash white/light-gray on initial paint
 * before flipping to dark mode after hydration.
 */
export const OGABASSEY_DARK_MODE_LCP_CSS = `
.storefront-variant-ogabassey {
  --storefront-dark-background: ${DARK_BG};
  --storefront-dark-foreground: ${DARK_FG};
  --storefront-dark-card: ${DARK_CARD};
  --storefront-dark-card-foreground: ${DARK_CARD_FG};
  --storefront-dark-muted: ${DARK_MUTED};
  --storefront-dark-muted-foreground: ${DARK_MUTED_FG};
  --storefront-dark-border: ${DARK_BORDER};
  --storefront-dark-primary: ${DARK_PRIMARY};
  --storefront-dark-primary-foreground: ${DARK_PRIMARY_FG};
  --storefront-dark-secondary: ${DARK_SECONDARY};
  --storefront-dark-secondary-foreground: ${DARK_SECONDARY_FG};
  --storefront-dark-accent: ${DARK_ACCENT};
  --storefront-dark-accent-foreground: ${DARK_ACCENT_FG};
  --storefront-dark-price: ${DARK_PRICE};
  --storefront-dark-rating: ${DARK_RATING};
  --storefront-dark-success: ${DARK_SUCCESS};
  --storefront-dark-warning: ${DARK_WARNING};
  --storefront-dark-error: ${DARK_ERROR};
}

@media (prefers-color-scheme: dark) {
  body:has(.storefront-variant-ogabassey.storefront-mode-system),
  body:has([data-ogabassey-home-lcp-shell]),
  body:has([data-ogabassey-home-hero-reserve-fallback]),
  .storefront-ppr-static-shell:has(
    .storefront-variant-ogabassey.storefront-mode-system
  ),
  .storefront-ppr-static-shell:has([data-ogabassey-home-lcp-shell]),
  .storefront-ppr-static-shell:has([data-ogabassey-home-hero-reserve-fallback]) {
    background-color: ${DARK_BG};
    color-scheme: dark;
    --store-background: ${DARK_BG} !important;
    --store-background-text: ${DARK_FG} !important;
    --store-foreground: ${DARK_FG} !important;
    --store-secondary: ${DARK_SECONDARY} !important;
    --store-secondary-text: ${DARK_SECONDARY_FG} !important;
    --store-border: ${DARK_BORDER} !important;
    --store-surface: ${DARK_CARD} !important;
    --ogabassey-surface: ${DARK_CARD} !important;
    --ogabassey-surface-text: ${DARK_CARD_FG} !important;
    --ogabassey-border: ${DARK_BORDER} !important;
  }

  .storefront-variant-ogabassey.storefront-mode-system,
  .storefront-variant-ogabassey.storefront-mode-system
    .ogabassey-storefront-shell {
    color-scheme: dark;
    --background: 0 0% 4% !important;
    --foreground: 210 40% 98% !important;
    --card: 0 0% 10% !important;
    --card-foreground: 210 40% 98% !important;
    --popover: 0 0% 10% !important;
    --popover-foreground: 210 40% 98% !important;
    --primary: 357 72% 48% !important;
    --primary-foreground: 0 0% 100% !important;
    --secondary: 0 0% 10% !important;
    --secondary-foreground: 0 0% 100% !important;
    --muted: 0 0% 15% !important;
    --muted-foreground: 216 12% 84% !important;
    --accent: 0 91% 71% !important;
    --accent-foreground: 0 0% 0% !important;
    --destructive: 0 91% 71% !important;
    --destructive-foreground: 0 0% 0% !important;
    --border: 215 28% 17% !important;
    --input: 215 28% 17% !important;
    --ring: 38 92% 50% !important;
    --store-primary: var(--storefront-dark-primary) !important;
    --store-primary-text: var(
      --storefront-dark-primary-foreground
    ) !important;
    --store-on-primary: var(--storefront-dark-primary-foreground) !important;
    --store-secondary: var(--storefront-dark-secondary) !important;
    --store-secondary-text: var(
      --storefront-dark-secondary-foreground
    ) !important;
    --store-accent: var(--storefront-dark-accent) !important;
    --store-accent-text: var(--storefront-dark-accent-foreground) !important;
    --store-background: var(--storefront-dark-background) !important;
    --store-background-text: var(--storefront-dark-foreground) !important;
    --store-foreground: var(--storefront-dark-foreground) !important;
    --store-border: var(--storefront-dark-border) !important;
    --store-rating: var(--storefront-dark-rating) !important;
    --store-option-secondary: var(--storefront-dark-muted) !important;
    --store-surface: var(--storefront-dark-card) !important;
    --storefront-shell-background: var(
      --storefront-dark-background
    ) !important;
    --ogabassey-shell-background: var(
      --storefront-dark-background
    ) !important;
    --ogabassey-shell-text: var(--storefront-dark-foreground) !important;
    --ogabassey-surface: var(--storefront-dark-card) !important;
    --ogabassey-surface-text: var(
      --storefront-dark-card-foreground
    ) !important;
    --ogabassey-surface-text-muted: var(
      --storefront-dark-muted-foreground
    ) !important;
    --ogabassey-border: var(--storefront-dark-border) !important;
  }

  .storefront-variant-ogabassey.storefront-mode-system
    .ogabassey-storefront-shell,
  .storefront-variant-ogabassey.storefront-mode-system.storefront-ppr-static-shell,
  .storefront-variant-ogabassey.storefront-mode-system
    .storefront-ppr-static-shell,
  .storefront-variant-ogabassey.storefront-mode-system
    .storefront-shell-loading {
    background-color: var(--storefront-dark-background);
    color: var(--storefront-dark-foreground);
  }
}
`;

/** Contain the streamed mobile carousel before its async utility CSS arrives. */
export const OGABASSEY_HOME_CAROUSEL_CRITICAL_CSS = `
@layer components {
  @media (max-width: 767px) {
    [data-ogabassey-hero] { width: 100%; background: var(--store-background, #ffffff); position: relative; }
    [data-ogabassey-hero] > section {
      max-width: 1400px; margin: 0 auto; padding: 1rem 1rem 0;
      position: relative; z-index: 10; display: flex; flex-direction: column;
    }
    [data-ogabassey-mobile-hero-bg-extension] {
      position: absolute; top: 0; left: 0; right: 0; height: 7rem;
      overflow: hidden; background: var(--ogabassey-shell-background, #0f0f0f); z-index: 0;
    }
    [data-ogabassey-mobile-hero] { margin-bottom: 1rem; order: 1; }
    [data-ogabassey-mobile-hero-panel] {
      position: relative; height: 192px; touch-action: pan-y;
      overflow: hidden; border-radius: 1rem; background: var(--store-secondary, #f3f4f6);
    }
    [data-ogabassey-mobile-hero-panel] > [role="group"] {
      position: absolute; inset: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));
    }
    [data-ogabassey-mobile-hero-panel] > [aria-hidden="true"] { opacity: 0; z-index: 0; }
    [data-ogabassey-mobile-hero-panel] > [aria-hidden="false"] { opacity: 1; z-index: 10; }
    [data-ogabassey-mobile-hero-panel] > [role="group"] > :first-child {
      grid-column: span 3 / span 3; display: flex; flex-direction: column;
      justify-content: center; gap: 0.25rem; padding: 1rem 1.25rem;
    }
    [data-ogabassey-mobile-hero-panel] h2 {
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3;
      overflow: hidden; font-size: 1.65rem; font-weight: 800; line-height: 1.05;
      color: var(--store-secondary-text, #111827);
    }
    [data-ogabassey-mobile-hero-panel] p { font-size: 11px; font-weight: 600; color: var(--store-secondary-text, #111827); }
    [data-ogabassey-mobile-hero-panel] > [role="group"] > :first-child > span:first-child {
      font-size: 9px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.12em; color: var(--store-primary, #d62027);
    }
    [data-ogabassey-mobile-hero-panel] > [role="group"] > :first-child > span:last-child {
      margin-top: 0.5rem; display: inline-flex; width: fit-content; align-items: center;
      border-radius: 9999px; background: var(--store-primary, #d62027);
      padding: 0.375rem 1rem; font-size: 11px; font-weight: 700;
      color: var(--store-on-primary, #ffffff);
    }
    [data-ogabassey-mobile-hero-panel] > [role="group"] > :nth-child(2) {
      position: relative; grid-column: span 2 / span 2;
      display: flex; align-items: center; justify-content: center; padding: 0.5rem;
    }
    [data-ogabassey-mobile-hero-panel] img { object-fit: contain; padding: 0.5rem; }
    [data-ogabassey-mobile-hero-panel] > [role="group"] > a { position: absolute; inset: 0; }
    [data-ogabassey-mobile-hero] > :last-child:not([role="region"]) {
      margin-top: 0.5rem; display: flex; align-items: center; gap: 0.5rem; padding: 0 0.25rem;
    }
    [data-ogabassey-mobile-hero] [aria-label="Hero carousel slide controls"] {
      display: flex; flex: 1; align-items: center; gap: 0.375rem;
    }
    [data-ogabassey-mobile-hero] [aria-label="Hero carousel slide controls"] > button { position: relative; height: 2.75rem; flex: 1; }
    [data-ogabassey-mobile-hero] [aria-label="Hero carousel slide controls"] > button > span {
      position: absolute; left: 0; right: 0; top: 50%; display: block; height: 0.25rem;
      translate: 0 -50%; overflow: hidden; border-radius: 9999px;
      background: color-mix(in srgb, var(--store-primary, #d62027) 20%, transparent);
    }
    [data-ogabassey-mobile-hero] button[aria-pressed],
    [data-ogabassey-carousel-toggle-slot] { height: 2.75rem; min-width: 2.75rem; border-radius: 9999px; }
    [data-ogabassey-mobile-hero] button[aria-pressed] {
      display: flex; align-items: center; justify-content: center;
      background: var(--store-primary, #d62027); color: var(--store-on-primary, #ffffff);
    }
    /* Even below-fold fill images need a containing block: otherwise they
       cover the committed copy while the full product stylesheet downloads. */
    .ogabassey-home-product-card { position: relative; }
    .ogabassey-home-product-card__media { position: relative; aspect-ratio: 1 / 1; overflow: hidden; }
    [data-ogabassey-hero-utility] {
      width: 100%; background: var(--store-background, #ffffff); color: var(--store-foreground, #111827); margin-top: 0.75rem; margin-bottom: 1.5rem;
      border-top: 1px solid #f3f4f6; border-bottom: 1px solid #f3f4f6;
    }
    [data-ogabassey-hero-utility] > :first-child { padding: 0 1rem; }
    [data-ogabassey-hero-utility] > :nth-child(2) { display: none; }
    [data-ogabassey-mobile-utility-panel] {
      min-height: 156px; background: var(--store-background, #ffffff); color: var(--store-foreground, #111827); border-radius: 1.5rem;
      border: 1px solid #f3f4f6; padding: 0.5rem;
    }
    [data-ogabassey-mobile-utility-panel] > :first-child {
      border-radius: 1rem; padding: 0.75rem 1rem; margin-bottom: 1rem;
      text-align: center; font-size: 0.875rem; line-height: 1.25rem;
      background: color-mix(in srgb, var(--store-primary, #d62027) 5%, transparent);
    }
    [data-ogabassey-mobile-utility-panel] > :last-child {
      display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.5rem; padding: 0 0.25rem 0.5rem;
    }
    [data-ogabassey-mobile-utility-panel] button { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 0; }
    [data-ogabassey-mobile-utility-panel] button > div {
      width: 3rem; height: 3rem; border-radius: 9999px; display: flex;
      align-items: center; justify-content: center; background: var(--store-secondary, #f3f4f6); color: var(--store-secondary-text, #111827);
    }
    [data-ogabassey-mobile-utility-panel] button > span { font-size: 0.75rem; line-height: 1rem; }
  }
}
`.trim();

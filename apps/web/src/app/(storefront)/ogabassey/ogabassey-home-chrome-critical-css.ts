/**
 * Mobile first-screen geometry, delivered with the committed home shell.
 * No fonts, external URLs, menus or below-fold utilities. The full stylesheet
 * loads automatically after hydration; these component-layer declarations
 * match its geometry so arriving CSS does not move the header or navigation.
 */
export const OGABASSEY_HOME_CHROME_CRITICAL_CSS = `
@layer theme, base, components, utilities;
@layer base {
  @media (max-width: 767px) {
    .ogabassey-storefront-shell { line-height: 1.5; }
    .ogabassey-storefront-shell *, .ogabassey-storefront-shell *::before,
    .ogabassey-storefront-shell *::after { box-sizing: border-box; }
    .ogabassey-storefront-shell :where(h2, p) { margin: 0; }
    .ogabassey-storefront-shell :where(img, svg) { display: block; max-width: 100%; }
    .ogabassey-storefront-shell :where(button, input) { font: inherit; border: 0; }
    .ogabassey-storefront-shell button { background: transparent; }
    .ogabassey-storefront-shell .sr-only {
      clip-path: inset(50%); border-width: 0; height: 1px; margin: -1px;
      overflow: hidden; padding: 0; position: absolute; white-space: nowrap; width: 1px;
    }
  }
}
@layer components {
  @media (max-width: 767px) {
    .ogabassey-storefront-shell {
      --ogabassey-brand: var(--store-primary, #d62027);
      --ogabassey-brand-text: var(--store-primary-text, var(--store-on-primary, #ffffff));
      --ogabassey-shell-background: var(--storefront-shell-background, #0f0f0f);
      --ogabassey-shell-text: var(--store-primary-text, #ffffff);
      --ogabassey-chrome-background: var(--ogabassey-shell-background);
      --ogabassey-chrome-text: var(--ogabassey-shell-text);
      --ogabassey-surface: var(--store-surface, var(--store-background, #ffffff));
      --ogabassey-surface-text: var(--store-background-text, #111827);
      background: var(--ogabassey-shell-background);
      color: var(--ogabassey-surface-text);
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      overflow-x: clip;
      position: relative;
    }
    .ogabassey-storefront-main { flex: 1 1 auto; }
    .ogabassey-navbar {
      position: sticky;
      top: 0;
      transform: translateY(-100%);
      z-index: 50;
    }
    .ogabassey-navbar[data-visible="true"] { transform: translateY(0); }
    .ogabassey-navbar__top {
      background: var(--ogabassey-chrome-background);
      color: var(--ogabassey-chrome-text);
      overflow: visible;
      position: relative;
      z-index: 20;
    }
    .ogabassey-navbar__inner { margin: 0 auto; max-width: 1400px; position: relative; z-index: 10; }
    .ogabassey-navbar__primary-row {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      justify-content: space-between;
      padding: 0.75rem 1rem 1.25rem;
    }
    .ogabassey-navbar__brand-row {
      align-items: center; display: flex; gap: 1rem;
      justify-content: space-between; min-height: 3rem; width: 100%;
    }
    .ogabassey-navbar__brand-group { align-items: center; display: flex; gap: 1rem; min-width: 0; }
    .ogabassey-navbar__menu-button {
      align-items: center; background: transparent; border: 0;
      color: var(--ogabassey-shell-text); cursor: pointer; display: flex;
      flex: 0 0 auto; height: 2.75rem; justify-content: center; padding: 0; width: 2.75rem;
    }
    .ogabassey-navbar__menu-button svg { height: 1.5rem; width: 1.5rem; }
    .ogabassey-navbar__logo-link {
      align-items: center; color: var(--ogabassey-shell-text); cursor: pointer;
      display: flex; min-width: 0; text-decoration: none;
    }
    .ogabassey-navbar__logo { height: 2.25rem; max-width: min(72vw, 18rem); width: auto; }
    .ogabassey-navbar__search-wrap { position: relative; width: 100%; z-index: 30; }
    .ogabassey-navbar-search { display: block; position: relative; width: 100%; }
    .ogabassey-navbar-search .ogabassey-navbar-search__input,
    .ogabassey-navbar-search input {
      background: var(--ogabassey-surface); border: 0; border-radius: 0.875rem;
      box-sizing: border-box; color: var(--store-foreground, var(--ogabassey-surface-text));
      display: block; font-size: 0.9375rem; height: 2.75rem;
      outline: 0; padding: 0 1rem 0 2.75rem; width: 100%;
    }
    .ogabassey-navbar-search__icon {
      color: color-mix(in srgb, var(--store-foreground, var(--ogabassey-surface-text, #111827)) 38%, transparent);
      height: 1.25rem; left: 1rem; pointer-events: none; position: absolute;
      top: 50%; translate: 0 -50%; width: 1.25rem; z-index: 20;
    }
    .ogabassey-navbar__desktop-actions, .ogabassey-navbar-secondary { display: none; }
    .ogabassey-mobile-footer {
      background: color-mix(in srgb, var(--ogabassey-shell-background) 96%, transparent);
      border-top: 1px solid color-mix(in srgb, var(--ogabassey-shell-text) 12%, transparent);
      bottom: 0; display: block; left: 0;
      padding-bottom: max(env(safe-area-inset-bottom, 0px), 4px);
      position: fixed; right: 0; transform: translateY(0); z-index: 70;
    }
    .ogabassey-mobile-footer--hidden { transform: translateY(110%); }
    .ogabassey-mobile-footer__highlight { height: 1px; left: 0; position: absolute; right: 0; top: 0; }
    .ogabassey-mobile-footer__pattern { inset: 0; opacity: 0.07; overflow: hidden; pointer-events: none; position: absolute; }
    .ogabassey-mobile-footer__items {
      align-items: center; display: flex; justify-content: space-around;
      padding: 0.4375rem 0.5rem 0.375rem; position: relative; z-index: 1;
    }
    .ogabassey-mobile-footer__item {
      align-items: center; color: color-mix(in srgb, var(--ogabassey-shell-text) 64%, transparent);
      display: flex; flex: 1 1 0; flex-direction: column; justify-content: center;
      min-width: 0; min-height: 3rem; padding: 0; text-decoration: none;
    }
    .ogabassey-mobile-footer__item[data-active="true"] { color: var(--ogabassey-shell-text); }
    .ogabassey-mobile-footer__icon { border-radius: 0.75rem; color: currentcolor; padding: 0.375rem; position: relative; }
    .ogabassey-mobile-footer__label {
      color: currentcolor; font-size: 0.625rem; font-weight: 650; line-height: 1;
      margin-top: 0.125rem; max-width: 100%; opacity: 0; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
    }
    .ogabassey-mobile-footer__item[data-active="true"] .ogabassey-mobile-footer__label { opacity: 1; }
  }
}
`.trim();

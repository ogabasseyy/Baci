/**
 * Final-size LCP CSS committed with the home text so Slow-4G does not wait
 * on Tailwind utilities or storefront-full.css. Keep this in a body `<style>`
 * next to the copy; layout CSS is still render-blocking, but the LCP node
 * must not change font-size/line-clamp after those sheets arrive.
 */
export const OGABASSEY_HOME_LCP_CRITICAL_CSS = `
.ogabassey-storefront-main {
  background: var(--store-background, #ffffff);
}
.ogabassey-header-chrome-loading {
  min-height: 132px;
}
@media (max-width: 767px) {
  /* Keep the footer below streaming content, not a blank viewport above it. */
  .ogabassey-storefront-main {
    min-height: calc(100svh - 132px);
  }
  .storefront-shell-loading {
    min-height: 132px;
    background: var(--store-background, #ffffff) !important;
  }
  [data-ogabassey-desktop-hero] { display: none !important; }
  .ogabassey-home-lcp-desktop-title { display: none !important; }
}
footer[aria-label="Semantic storefront footer"] {
  min-height: 1100px;
}
@media (min-width: 768px) {
  .ogabassey-storefront-main {
    min-height: 100svh;
  }
  .ogabassey-header-chrome-loading,
  .storefront-shell-loading {
    min-height: 128px;
    background: var(--store-background, #ffffff) !important;
  }
  footer[aria-label="Semantic storefront footer"] {
    min-height: 910px;
  }
  [data-ogabassey-mobile-hero],
  [data-ogabassey-empty-mobile-hero],
  [data-ogabassey-mobile-hero-bg-extension] {
    display: none !important;
  }
  [data-ogabassey-desktop-hero],
  [data-ogabassey-empty-desktop-hero] {
    display: grid !important;
    gap: 1rem;
    grid-template-columns: minmax(0, 1fr);
    height: auto;
    order: 2;
  }
}
@media (min-width: 1024px) {
  footer[aria-label="Semantic storefront footer"] {
    min-height: 770px;
  }
  [data-ogabassey-desktop-hero],
  [data-ogabassey-empty-desktop-hero] {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    height: 540px;
  }
}
.ogabassey-home-lcp-desktop-title {
  clip-path: inset(50%) !important;
  height: 1px !important;
  overflow: hidden !important;
  position: absolute !important;
  white-space: nowrap !important;
  width: 1px !important;
}
.ogabassey-home-committed-lcp {
  display: -webkit-box;
  font-family: "Inter Fallback", Arial, Helvetica, sans-serif !important;
  font-size: 0.875rem !important;
  -webkit-line-clamp: 2;
  line-height: 1.375 !important;
  overflow: hidden;
  -webkit-box-orient: vertical;
}
.ogabassey-home-unique-copy {
  font-size: 0.875rem;
  line-height: 1.5;
}
`.trim();

/**
 * Final-size LCP CSS committed with the home text so Slow-4G does not wait
 * on Tailwind utilities or storefront-full.css. Keep this in a body `<style>`
 * next to the copy; layout CSS is still render-blocking, but the LCP node
 * must not change font-size/line-clamp after those sheets arrive.
 */
export const OGABASSEY_HOME_LCP_CRITICAL_CSS = `
@media (max-width: 767px) {
  [data-ogabassey-home-lcp-shell] { min-height: 100svh; }
  [data-ogabassey-desktop-hero] { display: none !important; }
  .ogabassey-home-lcp-desktop-title { display: none !important; }
}
footer[aria-label="Semantic storefront footer"] {
  min-height: 1100px;
}
@media (min-width: 768px) {
  footer[aria-label="Semantic storefront footer"] {
    min-height: 910px;
  }
}
@media (min-width: 1024px) {
  footer[aria-label="Semantic storefront footer"] {
    min-height: 770px;
  }
}
.ogabassey-home-lcp-root {
  background: var(--store-background, #ffffff);
  position: relative;
  width: 100%;
}
.ogabassey-home-lcp-scrim {
  background: var(--ogabassey-shell-background, #1a1a1a);
  height: 7rem;
  left: 0;
  position: absolute;
  right: 0;
  top: 0;
  z-index: 0;
}
.ogabassey-home-lcp-inner {
  display: flex;
  flex-direction: column;
  margin-left: auto;
  margin-right: auto;
  max-width: 1400px;
  padding: 1rem 1rem 0;
  position: relative;
  z-index: 10;
}
.ogabassey-home-lcp-mobile {
  margin-bottom: 1rem;
  order: 1;
}
.ogabassey-home-lcp-panel {
  background: var(--store-secondary, #f3f4f6);
  border-radius: 1rem;
  box-shadow: 0 25px 50px -12px rgb(17 24 39 / 25%);
  height: 192px;
  overflow: hidden;
  position: relative;
}
.ogabassey-home-lcp-copy {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  inset: 0;
  justify-content: center;
  padding: 1rem 1.25rem;
  position: absolute;
}
.ogabassey-home-lcp-title {
  color: var(--store-secondary-text, #111827);
  display: -webkit-box;
  font-size: 1.65rem;
  font-weight: 800;
  -webkit-line-clamp: 3;
  line-height: 1.05;
  overflow: hidden;
  -webkit-box-orient: vertical;
}
.ogabassey-home-lcp-desktop-title {
  border: 0 !important;
  clip: rect(0, 0, 0, 0) !important;
  clip-path: inset(50%) !important;
  height: 1px !important;
  margin: -1px !important;
  overflow: hidden !important;
  padding: 0 !important;
  position: absolute !important;
  white-space: nowrap !important;
  width: 1px !important;
}
.ogabassey-home-committed-lcp {
  color: color-mix(in srgb, var(--store-secondary-text, #111827) 80%, transparent);
  display: -webkit-box;
  font-family: "Inter Fallback", Arial, Helvetica, sans-serif !important;
  font-size: 0.875rem !important;
  -webkit-line-clamp: 2;
  line-height: 1.375 !important;
  margin: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
}
.ogabassey-home-unique-copy {
  color: color-mix(in srgb, var(--store-secondary-text, #111827) 80%, transparent);
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0 auto 1rem;
  max-width: 1400px;
  padding: 0 1rem;
}
@media (min-width: 768px) {
  .ogabassey-home-lcp-scrim,
  .ogabassey-home-lcp-mobile,
  .ogabassey-home-unique-copy {
    display: none;
  }
  .ogabassey-home-lcp-inner {
    padding: 1.5rem 1.5rem 0;
  }
}
`.trim();

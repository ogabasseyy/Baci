/**
 * Committed LCP copy CSS. Keep this a TS string so Next does not emit a
 * render-blocking stylesheet request on Slow-4G (the former .css import
 * cost ~300ms wasted). Inject via StorefrontLcpCopyStyle.
 */
export const STOREFRONT_LCP_COPY_CSS = `
/*
  Lock committed LCP copy to the Inter fallback face so Slow-4G LCP does not
  wait on the 48KB latin Inter file (font-display:swap still made the webfont
  LCP-critical while body used --font-sans). Sizes match the Tailwind utilities
  those nodes already use, so later sheets do not restyle the LCP element.
*/

html, body {
  font-family: "Inter Fallback", Arial, Helvetica, sans-serif !important;
}

[data-cwv-lcp-fold] {
  min-height: 100svh;
}

[data-cwv-lcp-copy] {
  font-family: "Inter Fallback", Arial, Helvetica, sans-serif !important;
}

[data-cwv-lcp-copy="home"] {
  font-size: 1.65rem !important;
  font-weight: 800 !important;
  line-height: 1.05 !important;
  margin: 0 !important;
}

[data-cwv-lcp-copy="blog"] {
  font-size: 1.875rem !important;
  font-weight: 900 !important;
  line-height: 1 !important;
  margin: 0 0 1rem !important;
}

[data-cwv-lcp-copy="compare"] {
  font-size: 1.875rem !important;
  font-weight: 700 !important;
  line-height: 2.25rem !important;
  margin: 0 !important;
}

[data-cwv-lcp-copy="repair"] {
  font-size: 1.875rem !important;
  font-weight: 700 !important;
  line-height: 2.25rem !important;
  margin: 0 0 1rem !important;
}

[data-cwv-lcp-copy="imei"] {
  font-size: 1.875rem !important;
  font-weight: 800 !important;
  line-height: 2.25rem !important;
  margin: 0 0 1rem !important;
}

[data-cwv-lcp-copy="repairs"] {
  font-size: 1.875rem !important;
  font-weight: 800 !important;
  line-height: 2.25rem !important;
  margin: 0 0 1rem !important;
}

[data-cwv-lcp-support] {
  font-family: "Inter Fallback", Arial, Helvetica, sans-serif !important;
  font-size: 0.875rem !important;
  font-weight: 400 !important;
  line-height: 1.5 !important;
  max-width: 36rem;
}

/*
  Blog listing LCP frame. storefront-blog.css is deferred so this geometry must
  live on the shared render-blocking sheet or the 400px frame collapses until
  the Tailwind chunk arrives and restyles LCP.
*/
.ogabassey-blog-lcp-hero {
  min-height: 100svh;
  background: var(--color-gray-50, #f9fafb);
  padding: 2rem 1rem 0;
}

.ogabassey-blog-lcp-hero__inner {
  margin-left: auto;
  margin-right: auto;
  max-width: 1400px;
}

.ogabassey-blog-lcp-hero__frame {
  border-radius: 2rem;
  height: 400px;
  margin-bottom: 3rem;
  overflow: hidden;
  position: relative;
}

.ogabassey-blog-lcp-hero__copy {
  bottom: 0;
  left: 0;
  padding: 2rem;
  position: absolute;
  width: 100%;
}

.ogabassey-blog-featured-story__media {
  background: var(--ogabassey-blog-featured-scrim, rgb(17 24 39));
  inset: 0;
  position: absolute;
}

.ogabassey-blog-featured-story__title,
.ogabassey-blog-featured-story__description,
.ogabassey-blog-featured-story__date {
  color: var(--ogabassey-blog-featured-text, #ffffff);
  text-shadow: 0 2px 18px rgb(0 0 0 / 45%);
}

.ogabassey-blog-featured-story__title {
  display: -webkit-box;
  font-size: 1.875rem;
  font-weight: 900;
  -webkit-line-clamp: 3;
  line-height: 1;
  margin-bottom: 1rem;
  overflow: hidden;
  -webkit-box-orient: vertical;
}

.ogabassey-blog-featured-story__description {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  max-width: 42rem;
  opacity: 0.82;
  overflow: hidden;
  -webkit-box-orient: vertical;
}

.ogabassey-blog-featured-story__date {
  font-size: 0.875rem;
  opacity: 0.82;
}

/*
  storefront-core.css (and Tailwind .sr-only) is deferred until first input.
  Without this, streamed headings like Hero's h1.sr-only stay in normal flow
  and steal Slow-4G LCP from committed copy.
*/
.sr-only {
  border-width: 0 !important;
  clip-path: inset(50%) !important;
  height: 1px !important;
  margin: -1px !important;
  overflow: hidden !important;
  padding: 0 !important;
  position: absolute !important;
  white-space: nowrap !important;
  width: 1px !important;
}
`;

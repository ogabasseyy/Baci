/**
 * Brand/family authority-hub intro copy lock, interpolated into
 * STOREFRONT_LCP_COPY_CSS. The intro paragraph is the measured LCP node;
 * sizes mirror its text-base/leading-7 and sm:text-lg utilities, and margin
 * stays with the header's space-y utility.
 */
export const AUTHORITY_HUB_LCP_CSS = `
[data-cwv-lcp-copy="authority-hub"] {
  font-size: 1rem !important;
  line-height: 1.75rem !important;
}

@media (min-width: 640px) {
  [data-cwv-lcp-copy="authority-hub"] {
    font-size: 1.125rem !important;
  }
}
`;

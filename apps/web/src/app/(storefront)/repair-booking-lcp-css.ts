/** Inline critical CSS for the repair booking page's LCP elements. */
export const REPAIR_BOOKING_LCP_CSS = `
/* The repair booking title is followed by its form in the same viewport. */
[data-repair-booking-lcp-fold] {
  min-height: 0;
}

[data-cwv-lcp-copy="repair"] {
  color: var(--store-background-text, #111827) !important;
  font-size: 1.875rem !important;
  font-weight: 700 !important;
  letter-spacing: -0.025em !important;
  line-height: 2.25rem !important;
  margin: 0 !important;
  text-align: left !important;
}

@media (min-width: 640px) {
  [data-cwv-lcp-copy="repair"] {
    font-size: 2.25rem !important;
    line-height: 2.5rem !important;
  }
}
`;

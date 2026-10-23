import { STOREFRONT_LCP_COPY_CSS } from './storefront-lcp-copy-css';

// Full route styles can wait until first input; this geometry cannot.
const STOREFRONT_MAIN_RESERVE_CSS = `
.ogabassey-storefront-main {
  min-height: calc(100svh - 132px);
}
@media (min-width: 768px) {
  .ogabassey-storefront-main {
    min-height: 100svh;
  }
}
`;

export function StorefrontLcpCopyStyle() {
  return (
    <style href="storefront-lcp-copy" precedence="high">
      {`${STOREFRONT_MAIN_RESERVE_CSS}\n${STOREFRONT_LCP_COPY_CSS}`}
    </style>
  );
}

import { STOREFRONT_LCP_COPY_CSS } from './storefront-lcp-copy-css';

export function StorefrontLcpCopyStyle() {
  return (
    <style href="storefront-lcp-copy" precedence="high">
      {STOREFRONT_LCP_COPY_CSS}
    </style>
  );
}

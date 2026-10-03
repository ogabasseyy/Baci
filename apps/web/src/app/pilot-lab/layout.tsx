import type { ReactNode } from 'react';
import { StorefrontEagerFullCssLayout } from '@/app/(storefront)/storefront-eager-full-css-layout';

// Lab-only layout: serves the REAL storefront component styles (core + full
// sheets via the shared eager loader) identically in both arms, so the lab
// grid/card/hero render the responsive boxes, object-fit cropping, and
// screen-reader-only utilities the component contract expects. Production
// layouts are untouched; Next scopes this layout's styles to /pilot-lab.
export default function PilotLabLayout({ children }: { children: ReactNode }) {
  return (
    <StorefrontEagerFullCssLayout>{children}</StorefrontEagerFullCssLayout>
  );
}

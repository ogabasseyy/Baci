import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { StorefrontEagerFullCssLayout } from '@/app/(storefront)/storefront-eager-full-css-layout';
import { isPilotLabEnabled } from '@/lib/merchant-image-variant-pilot/lab-config';

// Lab-only layout: serves the REAL storefront component styles (core + full
// sheets via the shared eager loader) identically in both arms, so the lab
// grid/card/hero render the responsive boxes, object-fit cropping, and
// screen-reader-only utilities the component contract expects. Production
// layouts are untouched; Next scopes this layout's styles to /pilot-lab.
// Same fail-closed gate as every lab page: without the flag the segment is
// a 404, so a future page added without its own check cannot inherit
// lab rendering outside lab mode.
export default function PilotLabLayout({ children }: { children: ReactNode }) {
  if (!isPilotLabEnabled()) {
    notFound();
  }
  return (
    <StorefrontEagerFullCssLayout>{children}</StorefrontEagerFullCssLayout>
  );
}

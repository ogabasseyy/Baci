import type { ReactNode } from 'react';
import { StorefrontFullStyleLoader } from '@/app/(storefront)/storefront-full-style-loader';

// The shared [slug] layout resolves custom-domain routing with request headers
// before child listing routes render. Next.js 16 validates route entries
// independently, so the parent request boundary can hide the leaf loading UI
// during static-shell validation. Opt only this listing segment out of instant
// static-shell validation; keep the actual page content request-bound via the
// existing Suspense boundaries in products/search/category pages.
export const unstable_instant = false;

export default function StorefrontFullCssLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <StorefrontFullStyleLoader />
      {children}
    </>
  );
}

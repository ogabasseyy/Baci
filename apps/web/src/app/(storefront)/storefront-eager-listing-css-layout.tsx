import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-listing.css';
import type { ReactNode } from 'react';

export function StorefrontEagerListingCssLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}

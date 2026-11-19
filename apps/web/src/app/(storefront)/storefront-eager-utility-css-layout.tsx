import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-utility.css';
import type { ReactNode } from 'react';

export function StorefrontEagerUtilityCssLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}

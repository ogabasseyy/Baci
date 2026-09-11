import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-full.css';
import type { ReactNode } from 'react';

export function StorefrontEagerFullCssLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}

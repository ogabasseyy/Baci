import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-content.css';
import type { ReactNode } from 'react';
import { StorefrontFullStyleLoader } from '@/app/(storefront)/storefront-full-style-loader';

export default function StorefrontContentCssLayout({
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

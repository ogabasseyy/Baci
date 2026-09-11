import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-full.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
};

export default function StorefrontFullCssLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}

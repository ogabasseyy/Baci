import type { ReactNode } from 'react';
import { StorefrontFullStyleLoader } from '@/app/(storefront)/storefront-full-style-loader';

// The shared [slug] layout resolves custom-domain routing with request headers
// before child utility routes render. Next.js 16 validates route entries
// independently, so the parent request boundary can hide the leaf loading UI
// during static-shell validation. Opt this utility segment out of instant
// static-shell validation so /repair, /imei-check, and /repairs can paint their
// LCP copy from colocated loading.tsx in the visible PPR shell.
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

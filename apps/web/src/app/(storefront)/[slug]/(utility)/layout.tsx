import type { ReactNode } from 'react';
import { StorefrontFullStyleLoader } from '@/app/(storefront)/storefront-full-style-loader';
import { isOgabasseyStaticTenant } from '../ogabassey-static-params';

// The shared [slug] layout resolves custom-domain routing with request headers
// before child utility routes render. Next.js 16 validates route entries
// independently, so the parent request boundary can hide the leaf loading UI
// during static-shell validation. Opt this utility segment out of instant
// static-shell validation so /repair, /imei-check, and /repairs can paint their
// LCP copy from colocated loading.tsx in the visible PPR shell.
export const unstable_instant = false;

export default async function StorefrontFullCssLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (isOgabasseyStaticTenant(slug)) {
    return (
      <>
        <StorefrontFullStyleLoader />
        {children}
      </>
    );
  }

  const { StorefrontEagerFullCssLayout } = await import(
    '@/app/(storefront)/storefront-eager-full-css-layout'
  );

  return (
    <StorefrontEagerFullCssLayout>{children}</StorefrontEagerFullCssLayout>
  );
}

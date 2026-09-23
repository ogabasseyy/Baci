import type { ReactNode } from 'react';
import CustomerAuthLayout from '@/app/(storefront)/[slug]/customer-auth-layout';
import { StorefrontEagerFullCssLayout } from '@/app/(storefront)/storefront-eager-full-css-layout';

export default async function MemberStatusLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const resolvedParams = await params;

  return (
    <StorefrontEagerFullCssLayout>
      <CustomerAuthLayout params={{ slug: resolvedParams.slug.toLowerCase() }}>
        {children}
      </CustomerAuthLayout>
    </StorefrontEagerFullCssLayout>
  );
}

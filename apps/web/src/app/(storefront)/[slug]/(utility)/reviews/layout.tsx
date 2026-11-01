import type { ReactNode } from 'react';
import CustomerAuthLayout from '@/app/(storefront)/[slug]/customer-auth-layout';
import { StorefrontEagerUtilityCssLayout } from '@/app/(storefront)/storefront-eager-utility-css-layout';

export default async function ReviewsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const resolvedParams = await params;

  return (
    <StorefrontEagerUtilityCssLayout>
      <CustomerAuthLayout params={{ slug: resolvedParams.slug.toLowerCase() }}>
        {children}
      </CustomerAuthLayout>
    </StorefrontEagerUtilityCssLayout>
  );
}

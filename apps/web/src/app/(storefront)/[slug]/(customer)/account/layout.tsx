import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import CustomerAuthLayout from '@/app/(storefront)/[slug]/customer-auth-layout';

export const metadata: Metadata = {
  robots: { follow: true, index: false },
};

export default async function AccountLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  return (
    <CustomerAuthLayout params={await params}>{children}</CustomerAuthLayout>
  );
}

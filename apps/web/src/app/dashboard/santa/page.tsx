import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getConfiguredAgenticMerchantSlug } from '@/lib/agentic/agentic-merchant-slug';
import { getMerchantForUser } from '@/lib/merchant-server';
import SantaClientPage from './client-page';

export const metadata: Metadata = {
  title: 'Santa Analytics | Dashboard',
  description:
    'View real-time interactions and sales from the Santa AI campaign.',
};

export default async function SantaPage() {
  const { merchant } = await getMerchantForUser();

  const configuredMerchantSlug = getConfiguredAgenticMerchantSlug();
  if (!configuredMerchantSlug || merchant?.slug !== configuredMerchantSlug) {
    notFound();
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <Suspense fallback={<div>Loading Santa's workshop data…</div>}>
        <SantaClientPage />
      </Suspense>
    </div>
  );
}

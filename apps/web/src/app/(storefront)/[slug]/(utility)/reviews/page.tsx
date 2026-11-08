import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { OgabasseyV2Reviews } from '@/components/storefront/ogabassey/pages/reviews';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';

export const metadata: Metadata = {
  title: 'My Reviews | Ogabassey',
  description: 'Manage your product reviews and ratings',
};

export default async function ReviewsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Validate identifier
  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  // Get merchant data handling both slugs and domains
  const lookupKey = slug.toLowerCase();
  const merchant = isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(lookupKey)
    : await getCachedMerchant(lookupKey);

  if (merchant?.template_id !== 'ogabassey') {
    notFound();
  }

  return <OgabasseyV2Reviews />;
}

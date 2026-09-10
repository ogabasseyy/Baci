import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ImeiCheckerHero } from '@/components/storefront/ogabassey/pages/imei-checker-hero';
import { OgabasseyImeiCheckerShell } from '@/components/storefront/ogabassey/pages/imei-checker-shell';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';
import { getOgabasseyStaticParams } from '../../ogabassey-static-params';
import { ImeiCheckFallback } from './imei-check-fallback';
import { ImeiCheckPageContent } from './imei-check-page-content';

export const metadata: Metadata = {
  title: buildStorefrontMetadataTitle({
    title: 'IMEI Check',
    fallback: 'IMEI Check',
  }).metadataTitle,
  description:
    'Check phone IMEI status, review verification requirements, and confirm device identity before buying, swapping, repairing or reselling a phone.',
};

export function generateStaticParams(): Array<{ slug: string }> {
  return getOgabasseyStaticParams();
}

export async function ImeiCheckResolvedContent({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const lookupKey = slug.toLowerCase();
  const merchant = isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(lookupKey)
    : await getCachedMerchant(lookupKey);

  if (!merchant) {
    notFound();
  }

  if (merchant.template_id !== OGABASSEY_TEMPLATE_ID) {
    notFound();
  }

  return <ImeiCheckPageContent />;
}

export default function ImeiCheckPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <OgabasseyImeiCheckerShell>
      <ImeiCheckerHero />
      <Suspense fallback={<ImeiCheckFallback hideHero />}>
        <ImeiCheckResolvedContent params={params} />
      </Suspense>
    </OgabasseyImeiCheckerShell>
  );
}

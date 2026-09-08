import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OgabasseyImeiChecker } from '@/components/storefront/ogabassey/pages/imei-checker';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';

export const metadata: Metadata = {
  title: buildStorefrontMetadataTitle({
    title: 'IMEI Check',
    fallback: 'IMEI Check',
  }).metadataTitle,
  description:
    'Check phone IMEI status, review verification requirements, and confirm device identity before buying, swapping, repairing or reselling a phone.',
};

export default async function ImeiCheckPage({
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

  if (!merchant) {
    notFound();
  }

  // Only show for Ogabassey template (merchant-specific feature)
  if (
    (merchant as unknown as { template_id?: string }).template_id !==
    'ogabassey'
  ) {
    notFound();
  }

  return (
    <>
      <OgabasseyImeiChecker />
      <section className="mx-auto max-w-[1400px] px-4 pb-20 md:px-6">
        <div className="rounded-2xl border border-store-border bg-store-background-text/5 p-6 shadow-sm md:p-8">
          <h2 className="text-xl font-bold text-store-background-text">
            What to confirm before running an IMEI check
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-6 text-store-background-text/70 md:text-base md:leading-7">
            <p>
              An IMEI check helps verify a phone identity before purchase,
              repair, swap or resale. Use the exact IMEI from the device
              settings, SIM tray, retail box or dial screen, and compare the
              reported model with the phone you are inspecting.
            </p>
            <p>
              For used and open-box phones, confirm network status, carrier
              locks, model region, warranty signals and blacklist indicators
              before paying. A clean report is one part of due diligence; also
              inspect the screen, battery, Face ID or fingerprint sensor,
              cameras, charging port and proof of ownership.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OgabasseyV2Swap } from '@/components/storefront/ogabassey/pages/swap';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Swap Your Device',
  description:
    'Trade in an eligible phone, laptop, console or tablet, review valuation requirements, and use your device value toward an upgrade.',
};

export default async function SwapPage({
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
      <OgabasseyV2Swap />
      <section className="mx-auto max-w-[1400px] px-4 pb-20 md:px-6">
        <div className="rounded-2xl border border-store-border bg-store-background-text/5 p-6 shadow-sm md:p-8">
          <h2 className="text-xl font-bold text-store-background-text">
            How to prepare your device for swap
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-6 text-store-background-text/70 md:text-base md:leading-7">
            <p>
              Use the swap page to estimate trade-in value before you upgrade.
              The final offer can depend on the exact model, storage size,
              screen condition, battery health, camera condition, accessories,
              repair history and whether the device powers on normally.
            </p>
            <p>
              Before submitting a device, back up your data, remove personal
              accounts where possible, clean the device, and keep the charger,
              receipt or box available if you have them. Support may request a
              clearer video or physical inspection before confirming the final
              credit toward your next purchase.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

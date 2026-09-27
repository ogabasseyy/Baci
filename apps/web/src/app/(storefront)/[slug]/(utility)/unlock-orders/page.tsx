import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { OgabasseyUnlockOrders } from '@/components/storefront/ogabassey/pages/unlock-orders';
import { STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM } from '@/config/storefront-metadata-cache-bots';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';

export const metadata: Metadata = {
  description: 'Track clean carrier-unlock orders.',
  robots: { follow: false, index: false },
  title: 'Unlock Orders',
};

export default async function UnlockOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = searchParams ? await searchParams : {};
  if (!isValidMerchantIdentifier(slug)) notFound();
  const lookupKey = slug.toLowerCase();
  const merchant = isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(lookupKey)
    : await getCachedMerchant(lookupKey);
  if (merchant?.template_id !== 'ogabassey') {
    // The proxy cannot resolve a merchant template before its retired-slug
    // prefix strip. If this exact custom-domain path is a retired alias, retain
    // the redirect here after the merchant is known instead of returning 404.
    if (
      isDomainIdentifier(slug) &&
      merchant?.slug &&
      (await getCurrentSlugForAlias('unlock-orders'))?.toLowerCase() ===
        merchant.slug.toLowerCase()
    ) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (key === STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM) continue;
        if (Array.isArray(value)) {
          for (const entry of value) search.append(key, entry);
        } else if (value !== undefined) {
          search.append(key, value);
        }
      }
      redirect(`/${search.size ? `?${search.toString()}` : ''}`);
    }
    notFound();
  }
  return <OgabasseyUnlockOrders />;
}

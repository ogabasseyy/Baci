import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { buildRequestScopedStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { parseStorefrontSearchQueryParam } from '@/lib/storefront-search-params';
import { isValidMerchantIdentifier } from '@/lib/validation';
import { SearchPageContent, type SearchPageProps } from './search-page-content';

export async function generateMetadata({
  params,
  searchParams,
}: SearchPageProps): Promise<Metadata> {
  const { slug } = await params;

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    notFound();
  }

  const { q } = await searchParams;
  const sanitizedQuery = parseStorefrontSearchQueryParam(q);
  const baseUrl = buildRequestScopedStoreUrl(merchant, await headers());

  const { metadataTitle } = buildStorefrontMetadataTitle({
    title: sanitizedQuery ? `Search results for ${sanitizedQuery}` : 'Search',
    suffix: merchant.business_name,
    fallback: 'Search',
  });

  return {
    title: metadataTitle,
    robots: {
      index: false,
      follow: true,
    },
    alternates: {
      canonical: sanitizedQuery
        ? `${baseUrl}/search?q=${encodeURIComponent(sanitizedQuery)}`
        : `${baseUrl}/search`,
    },
  };
}

export default function SearchPage(props: SearchPageProps) {
  return <SearchPageContent {...props} />;
}

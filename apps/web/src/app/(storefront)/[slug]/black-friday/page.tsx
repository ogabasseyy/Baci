import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { OgabasseyBlackFridayPage } from '@/app/(storefront)/ogabassey/ogabassey-black-friday-page';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { isPublishedOgabassey } from '@/lib/ogabassey-black-friday';
import { buildRequestScopedStoreUrl } from '@/lib/store-url';
import { resolveMerchantContextIdentifier } from '@/lib/storefront-route-identifier';
import { isDomainIdentifier } from '@/lib/validation';
import CategoryPage, {
  generateMetadata as generateCategoryMetadata,
} from '../(catalog)/(listing)/[category]/page';

export const unstable_instant = false;

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function asCategoryProps(props: PageProps) {
  return {
    ...props,
    params: props.params.then(({ slug }) => ({
      slug,
      category: 'black-friday',
    })),
  };
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const merchant = await getRequestScopedMerchant(slug);
  if (!merchant || !isPublishedOgabassey(merchant)) {
    return generateCategoryMetadata(asCategoryProps(props));
  }

  const canonical = `${buildRequestScopedStoreUrl(merchant, await headers())}/black-friday`;
  const title = 'Black Friday 2026 | Ogabassey';
  const description =
    'Explore Ogabassey’s curated Black Friday device lineup for 27 November 2026.';
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: false, follow: true },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'website',
      images: ['/campaigns/black-friday-hero-768.webp'],
    },
  };
}

async function BlackFridayRuntime(props: PageProps) {
  await connection();
  const { slug } = await props.params;
  const merchant = await getRequestScopedMerchant(slug);
  if (!isPublishedOgabassey(merchant)) {
    return <CategoryPage {...asCategoryProps(props)} />;
  }

  const context = resolveMerchantContextIdentifier(await headers());
  const pathPrefix = context || isDomainIdentifier(slug) ? '' : `/${slug}`;
  return (
    <OgabasseyBlackFridayPage
      pathPrefix={pathPrefix}
      filters={props.searchParams}
    />
  );
}

export default function BlackFridayPage(props: PageProps) {
  return (
    <Suspense fallback={null}>
      <BlackFridayRuntime {...props} />
    </Suspense>
  );
}

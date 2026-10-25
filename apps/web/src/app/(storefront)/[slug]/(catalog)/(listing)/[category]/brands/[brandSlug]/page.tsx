import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CatalogListingLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { getIndexableRobotsMetadata } from '@/lib/seo-utils';
import { brandAuthorityPageRuntime } from './brand-authority-page-runtime';

interface BrandAuthorityPageRouteProps {
  params: Promise<{
    slug: string;
    category: string;
    brandSlug: string;
  }>;
}

const BRAND_HUB_NOT_FOUND_METADATA: Metadata = {
  title: 'Brand Hub Not Found',
  description: 'This brand hub is unavailable.',
  robots: { index: false, follow: true },
  alternates: null,
  openGraph: undefined,
  twitter: undefined,
};

export async function generateMetadata(
  props: BrandAuthorityPageRouteProps
): Promise<Metadata> {
  const { page } = await brandAuthorityPageRuntime.loadIndexablePage(props);

  if (!page || ('isIndexable' in page && !page.isIndexable)) {
    return BRAND_HUB_NOT_FOUND_METADATA;
  }

  return {
    title: { absolute: page.metaTitle },
    description: page.metaDescription,
    alternates: { canonical: page.canonicalUrl },
    robots: getIndexableRobotsMetadata(),
  };
}

function BrandAuthorityPageRuntime(props: BrandAuthorityPageRouteProps) {
  return brandAuthorityPageRuntime.render(props);
}

export default function BrandAuthorityPage(
  props: BrandAuthorityPageRouteProps
) {
  return (
    <Suspense fallback={<CatalogListingLoading />}>
      <BrandAuthorityPageRuntime {...props} />
    </Suspense>
  );
}

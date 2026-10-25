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

export async function generateMetadata(
  props: BrandAuthorityPageRouteProps
): Promise<Metadata> {
  const { page } = await brandAuthorityPageRuntime.loadIndexablePage(props);

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

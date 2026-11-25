import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CatalogListingLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { getIndexableRobotsMetadata } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import {
  getStorefrontOpenGraphImages,
  getStorefrontTwitterImages,
} from '@/lib/storefront-social-images';
import { brandAuthorityPageRuntime } from './brand-authority-page-runtime';
import {
  type BrandAuthorityStaticParam,
  resolveBrandAuthorityStaticParams,
} from './brand-authority-static-params';

interface BrandAuthorityPageRouteProps {
  params: Promise<{
    slug: string;
    category: string;
    brandSlug: string;
  }>;
}

export function generateStaticParams(): Promise<BrandAuthorityStaticParam[]> {
  return resolveBrandAuthorityStaticParams();
}

export async function generateMetadata(
  props: BrandAuthorityPageRouteProps
): Promise<Metadata> {
  const { page } = await brandAuthorityPageRuntime.loadIndexablePage(props);

  let baseUrl = '';
  try {
    baseUrl = new URL(page.canonicalUrl).origin;
  } catch {
    baseUrl = page.merchant ? buildStoreUrl(page.merchant) : '';
  }

  const imageCandidates = [page.products?.[0]?.image];

  return {
    title: { absolute: page.metaTitle },
    description: page.metaDescription,
    alternates: { canonical: page.canonicalUrl },
    robots: getIndexableRobotsMetadata(),
    openGraph: {
      title: page.metaTitle,
      description: page.metaDescription,
      url: page.canonicalUrl,
      type: 'website',
      siteName: page.merchant?.business_name,
      images: getStorefrontOpenGraphImages(
        baseUrl,
        page.metaTitle,
        ...imageCandidates
      ),
    },
    twitter: {
      card: 'summary_large_image',
      title: page.metaTitle,
      description: page.metaDescription,
      images: getStorefrontTwitterImages(baseUrl, ...imageCandidates),
    },
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

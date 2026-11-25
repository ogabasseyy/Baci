import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CatalogListingLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { getIndexableRobotsMetadata } from '@/lib/seo-utils';
import {
  getStorefrontOpenGraphImages,
  getStorefrontTwitterImages,
} from '@/lib/storefront-social-images';
import {
  type ModelFamilyPageRouteProps,
  modelFamilyPageRuntime,
} from './model-family-page-runtime';
import {
  type ModelFamilyStaticParam,
  resolveModelFamilyStaticParams,
} from './model-family-static-params';

export function generateStaticParams(): Promise<ModelFamilyStaticParam[]> {
  return resolveModelFamilyStaticParams();
}

export async function generateMetadata(
  props: ModelFamilyPageRouteProps
): Promise<Metadata> {
  const { page } = await modelFamilyPageRuntime.loadIndexablePage(props);
  let baseUrl = '';
  try {
    baseUrl = new URL(page.canonicalUrl).origin;
  } catch {
    baseUrl = '';
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

function ModelFamilyPageRuntime(props: ModelFamilyPageRouteProps) {
  return modelFamilyPageRuntime.render(props);
}

export default function ModelFamilyPage(props: ModelFamilyPageRouteProps) {
  return (
    <Suspense fallback={<CatalogListingLoading />}>
      <ModelFamilyPageRuntime {...props} />
    </Suspense>
  );
}

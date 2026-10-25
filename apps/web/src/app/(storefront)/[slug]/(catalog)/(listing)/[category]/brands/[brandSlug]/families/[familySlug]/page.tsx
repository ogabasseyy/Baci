import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CatalogListingLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { getIndexableRobotsMetadata } from '@/lib/seo-utils';
import {
  type ModelFamilyPageRouteProps,
  modelFamilyPageRuntime,
} from './model-family-page-runtime';

export async function generateMetadata(
  props: ModelFamilyPageRouteProps
): Promise<Metadata> {
  const { page } = await modelFamilyPageRuntime.loadIndexablePage(props);
  return {
    title: { absolute: page.metaTitle },
    description: page.metaDescription,
    alternates: { canonical: page.canonicalUrl },
    robots: getIndexableRobotsMetadata(),
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

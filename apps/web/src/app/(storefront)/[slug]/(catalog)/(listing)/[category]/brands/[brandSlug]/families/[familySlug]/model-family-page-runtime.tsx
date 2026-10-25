import { connection } from 'next/server';
import { cache } from 'react';
import { StorefrontRouteNotFoundContent } from '@/app/(storefront)/[slug]/storefront-route-not-found-content';
import { brandAuthorityPageLoader } from '@/lib/storefront-category/load-brand-authority-page';
import { modelFamilyAuthorityPageLoader } from '@/lib/storefront-category/load-model-family-authority-page';
import { BrandAuthorityPageContent } from '../../brand-authority-page-content';

export interface ModelFamilyPageRouteProps {
  params: Promise<{
    slug: string;
    category: string;
    brandSlug: string;
    familySlug: string;
  }>;
}

const loadIndexableModelFamilyPageData = cache(
  async (
    merchantSlug: string,
    categorySlug: string,
    brandSlug: string,
    familySlug: string
  ) => {
    const page = await modelFamilyAuthorityPageLoader.load({
      merchantSlug,
      categorySlug,
      brandSlug,
      familySlug,
    });
    return { page, merchantSlug };
  }
);

async function loadIndexableModelFamilyPage(props: ModelFamilyPageRouteProps) {
  const params = await props.params;
  const loaded = await loadIndexableModelFamilyPageData(
    params.slug,
    params.category,
    params.brandSlug,
    params.familySlug
  );
  return { ...loaded, resolvedParams: params };
}

async function renderModelFamilyPage(props: ModelFamilyPageRouteProps) {
  await connection();
  const { page, merchantSlug } = await loadIndexableModelFamilyPage(props);
  const pathPrefix = await brandAuthorityPageLoader.getStorefrontPathPrefix(
    merchantSlug,
    page?.merchant.slug ?? merchantSlug
  );

  if (!page || ('isIndexable' in page && !page.isIndexable)) {
    return (
      <StorefrontRouteNotFoundContent
        backHref={pathPrefix || '/'}
        message="This model family hub is unavailable or has moved."
        title="Model family hub not found"
      />
    );
  }

  return <BrandAuthorityPageContent page={{ ...page, pathPrefix }} />;
}

export const modelFamilyPageRuntime = {
  loadIndexablePage: loadIndexableModelFamilyPage,
  render: renderModelFamilyPage,
};

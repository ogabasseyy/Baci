import { connection } from 'next/server';
import { cache } from 'react';
import { StorefrontRouteNotFoundContent } from '@/app/(storefront)/[slug]/storefront-route-not-found-content';
import { brandAuthorityPageLoader } from '@/lib/storefront-category/load-brand-authority-page';
import { BrandAuthorityPageContent } from './brand-authority-page-content';

interface BrandAuthorityPageRouteProps {
  params: Promise<{
    slug: string;
    category: string;
    brandSlug: string;
  }>;
}

const loadIndexableBrandAuthorityPageData = cache(
  async (merchantSlug: string, categorySlug: string, brandSlug: string) => {
    const page = await brandAuthorityPageLoader.load(
      {
        merchantSlug,
        categorySlug,
        brandSlug,
      },
      { includeRequestPathPrefix: false }
    );

    return { page, merchantSlug };
  }
);

async function loadIndexableBrandAuthorityPage(
  props: BrandAuthorityPageRouteProps
) {
  const resolvedParams = await props.params;
  const { page, merchantSlug } = await loadIndexableBrandAuthorityPageData(
    resolvedParams.slug,
    resolvedParams.category,
    resolvedParams.brandSlug
  );

  return { page, resolvedParams, merchantSlug };
}

async function renderBrandAuthorityPage(props: BrandAuthorityPageRouteProps) {
  await connection();
  const { page, merchantSlug } = await loadIndexableBrandAuthorityPage(props);
  const pathPrefix = await brandAuthorityPageLoader.getStorefrontPathPrefix(
    merchantSlug,
    page?.merchant.slug ?? merchantSlug
  );

  if (!page || ('isIndexable' in page && !page.isIndexable)) {
    return (
      <StorefrontRouteNotFoundContent
        backHref={pathPrefix || '/'}
        message="This brand hub is unavailable or has moved."
        title="Brand hub not found"
      />
    );
  }

  return <BrandAuthorityPageContent page={{ ...page, pathPrefix }} />;
}

export const brandAuthorityPageRuntime = {
  loadIndexablePage: loadIndexableBrandAuthorityPage,
  render: renderBrandAuthorityPage,
};

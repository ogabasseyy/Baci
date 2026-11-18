import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CatalogListingLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { getCachedStorefrontProductIndex } from '@/lib/cached-storefront-product-index';
import {
  generateMetaDescription,
  getCanonicalStorefrontFilterSearchParams,
  getIndexableRobotsMetadata,
} from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import {
  buildStorefrontPageHref,
  parseStorefrontPageParam,
  STOREFRONT_PRODUCTS_PER_PAGE,
} from '@/lib/storefront-pagination';
import {
  getStorefrontOpenGraphImages,
  getStorefrontTwitterImages,
} from '@/lib/storefront-social-images';
import { isValidMerchantIdentifier } from '@/lib/validation';
import { ProductsPageContent } from './products-page-content';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function buildProductsNotFoundMetadata(
  title = 'Products page not found',
  description = 'This products page is unavailable or has moved.'
): Metadata {
  return {
    title,
    description,
    // Replace root metadata alternates so soft-404 pages do not inherit a canonical.
    alternates: null,
    robots: { index: false, follow: true },
    openGraph: {
      title,
      description,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const currentPage = parseStorefrontPageParam(resolvedSearchParams.page);

  if (!currentPage) {
    return buildProductsNotFoundMetadata();
  }

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    return {
      title: 'Store Not Found',
    };
  }

  const productIndex = await getCachedStorefrontProductIndex(merchant.id, {
    page: currentPage,
    limit: STOREFRONT_PRODUCTS_PER_PAGE,
  });
  const totalPages = Math.max(1, productIndex.totalPages || 1);

  if (!productIndex.hasError && currentPage > totalPages) {
    return buildProductsNotFoundMetadata();
  }

  const baseUrl = buildStoreUrl(merchant);
  const canonicalFilterParams =
    getCanonicalStorefrontFilterSearchParams(resolvedSearchParams);
  const canonicalFilterQuery = canonicalFilterParams.toString();
  const productsUrl = `${baseUrl}/products${canonicalFilterQuery ? `?${canonicalFilterQuery}` : ''}`;
  const paginatedProductsUrl = buildStorefrontPageHref(
    productsUrl,
    currentPage
  );
  const { metadataTitle, title } = buildStorefrontMetadataTitle({
    title: currentPage > 1 ? `Products | Page ${currentPage}` : 'Products',
    suffix: merchant.business_name,
    fallback: 'Products',
  });
  const fallbackDescription = `Browse all products available at ${merchant.business_name}. Compare smartphones, laptops, accessories, and gaming devices with nationwide delivery and flexible payment options.`;
  const baseDescription = merchant.site_description || fallbackDescription;
  const pageAwareDescription =
    currentPage > 1
      ? `Page ${currentPage} of ${totalPages}: ${baseDescription}`
      : baseDescription;
  const pageAwareFallback =
    currentPage > 1
      ? `Page ${currentPage} of ${totalPages}: ${fallbackDescription}`
      : fallbackDescription;
  const description = generateMetaDescription(pageAwareDescription, 160, {
    minLength: 110,
    fallback: pageAwareFallback,
  });
  const socialImageCandidates = [
    productIndex.products[0]?.image,
    productIndex.products[0]?.imageLarge,
    merchant.logo_url,
  ];

  return {
    title: metadataTitle,
    description,
    alternates: {
      canonical: paginatedProductsUrl,
    },
    robots: getIndexableRobotsMetadata(resolvedSearchParams),
    openGraph: {
      title,
      description,
      url: paginatedProductsUrl,
      type: 'website',
      siteName: merchant.business_name,
      images: getStorefrontOpenGraphImages(
        baseUrl,
        productIndex.products[0]?.name || `${merchant.business_name} products`,
        ...socialImageCandidates
      ),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: getStorefrontTwitterImages(baseUrl, ...socialImageCandidates),
    },
  };
}

function ProductsListingRuntime(props: PageProps) {
  return <ProductsPageContent {...props} />;
}

export default function ProductsPage(props: PageProps) {
  return (
    <Suspense fallback={<CatalogListingLoading />}>
      <ProductsListingRuntime {...props} />
    </Suspense>
  );
}

import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { BreadcrumbList, CollectionPage, WithContext } from 'schema-dts';
import { JsonLd } from '@/components/seo/json-ld';
import { SearchSubmissionForm } from '@/components/storefront/search-submission';
import { SearchSubmissionLink } from '@/components/storefront/search-submission-link';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { asRoute } from '@/lib/routes';
import { sanitizeSearchQuery } from '@/lib/sanitize-core';
import { generateBreadcrumbSchema, getProductUrl } from '@/lib/seo-utils';
import { buildRequestScopedStoreUrl } from '@/lib/store-url';
import { getStorefrontPathPrefix } from '@/lib/storefront-path-prefix';
import { getStorefrontSearchProducts } from '@/lib/storefront-search';
import { isValidMerchantIdentifier } from '@/lib/validation';
import { ProductIndexCard } from '../products/product-index-card';

export interface SearchPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}

const RESULT_COUNT_FORMATTER = new Intl.NumberFormat('en-NG');

const priceFormatterCache = new Map<string, Intl.NumberFormat>();

function getPriceFormatter(currency: string): Intl.NumberFormat {
  let formatter = priceFormatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    priceFormatterCache.set(currency, formatter);
  }
  return formatter;
}

function formatResultCount(count: number) {
  return RESULT_COUNT_FORMATTER.format(count);
}

function formatSearchSummary({
  query,
  totalCount,
  visibleCount,
}: {
  query: string;
  totalCount: number;
  visibleCount: number;
}) {
  if (!query) {
    return 'Enter a search term to browse matching products.';
  }

  if (totalCount === 0) {
    return `No results found for “${query}”`;
  }

  if (totalCount > visibleCount) {
    return `Showing first ${formatResultCount(visibleCount)} of ${formatResultCount(totalCount)} results for “${query}”`;
  }

  return `${formatResultCount(totalCount)} result${totalCount === 1 ? '' : 's'} for “${query}”`;
}

export async function SearchPageContent({
  params,
  searchParams,
}: SearchPageProps) {
  const { slug } = await params;
  const { q } = await searchParams;
  const query = sanitizeSearchQuery(q || '');

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    notFound();
  }

  const searchResult = query
    ? await getStorefrontSearchProducts({
        merchantId: merchant.id,
        query,
        limit: 20,
      })
    : {
        count: 0,
        didYouMean: null,
        products: [],
        query: '',
      };
  const searchQuery = searchResult.query;

  const headersList = await headers();
  const pathPrefix = getStorefrontPathPrefix(headersList, merchant);
  const allProductsHref = `${pathPrefix}/products`;
  const contactHref = `${pathPrefix}/contact`;
  const storeUrl = buildRequestScopedStoreUrl(merchant, headersList);
  const pageUrl = searchQuery
    ? `${storeUrl}/search?q=${encodeURIComponent(searchQuery)}`
    : `${storeUrl}/search`;
  const merchantCurrency = resolveMerchantCurrencyConfig(merchant).code;
  const priceFormatter = getPriceFormatter(merchantCurrency);
  const visibleCount = searchResult.products.length;
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: merchant.business_name, url: storeUrl },
    { name: 'Search Results', url: pageUrl },
  ]);
  const searchResultsSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: searchQuery
      ? `Search results for ${searchQuery}`
      : `Search results | ${merchant.business_name}`,
    url: pageUrl,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: searchResult.products.map((product, index) => {
        const productUrl = `${storeUrl}${getProductUrl(product)}`;

        return {
          '@type': 'ListItem',
          position: index + 1,
          item: {
            '@type': 'Product',
            name: product.name,
            url: productUrl || undefined,
            image: product.imageLarge || product.image || undefined,
            offers: {
              '@type': 'Offer',
              price: product.price,
              priceCurrency: merchantCurrency,
              url: productUrl || undefined,
            },
          },
        };
      }),
    },
    numberOfItems: searchResult.products.length,
  };

  return (
    <>
      <JsonLd
        data={breadcrumbSchema as unknown as WithContext<BreadcrumbList>}
      />
      <JsonLd
        data={searchResultsSchema as unknown as WithContext<CollectionPage>}
      />
      <div className="min-h-screen bg-[color-mix(in_srgb,var(--store-background,#ffffff)_94%,var(--store-background-text,#111827)_6%)] pb-20 pt-6">
        <div className="mx-auto max-w-[1400px] px-4 md:px-6">
          <nav className="flex items-center gap-2 text-sm text-store-background-text/55">
            <Link
              href={asRoute(pathPrefix || '/')}
              prefetch={false}
              className="transition-colors hover:text-store-primary"
            >
              Home
            </Link>
            <span aria-hidden="true">/</span>
            <span className="font-medium text-store-background-text">
              Search
            </span>
          </nav>

          <div className="mt-6 space-y-2">
            <h1 className="text-3xl font-bold text-store-background-text md:text-4xl">
              Search Results
            </h1>
            <p className="max-w-2xl text-sm text-store-background-text/60 md:text-base">
              {formatSearchSummary({
                query,
                totalCount: searchResult.count,
                visibleCount,
              })}
            </p>
          </div>

          <SearchSubmissionForm
            key={searchQuery}
            pathPrefix={pathPrefix}
            query={searchQuery}
          />

          {searchResult.didYouMean && (
            <p className="mt-4 text-sm text-store-background-text/55">
              Did you mean{' '}
              <SearchSubmissionLink
                pathPrefix={pathPrefix}
                query={searchResult.didYouMean}
                source="did-you-mean"
                className="font-medium text-store-primary underline-offset-4 hover:underline"
              >
                {searchResult.didYouMean}
              </SearchSubmissionLink>
              ?
            </p>
          )}

          {searchQuery ? (
            searchResult.products.length > 0 ? (
              <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {searchResult.products.map((product) => (
                  <ProductIndexCard
                    key={product.id}
                    formattedPrice={priceFormatter.format(product.price)}
                    pathPrefix={pathPrefix}
                    product={product}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-10 rounded-3xl border border-store-background-text/10 bg-store-background px-6 py-16 text-center shadow-sm">
                <h2 className="text-xl font-semibold text-store-background-text">
                  No products found
                </h2>
                <p className="mt-2 text-sm text-store-background-text/55">
                  We could not find any products matching “{searchQuery}”.
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <Link
                    href={asRoute(allProductsHref)}
                    prefetch={false}
                    className="rounded-md bg-store-primary px-4 py-2 text-sm font-semibold text-store-primary-text transition hover:opacity-90"
                  >
                    View all products
                  </Link>
                  <Link
                    href={asRoute(contactHref)}
                    prefetch={false}
                    className="rounded-md border border-store-background-text/15 px-4 py-2 text-sm font-semibold text-store-background-text transition hover:border-store-primary hover:text-store-primary"
                  >
                    Contact support
                  </Link>
                </div>
              </div>
            )
          ) : (
            <div className="mt-10 rounded-3xl border border-store-background-text/10 bg-store-background px-6 py-16 text-center shadow-sm">
              <h2 className="text-xl font-semibold text-store-background-text">
                Start a search
              </h2>
              <p className="mt-2 text-sm text-store-background-text/55">
                Enter a product name or keyword to see matching items.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

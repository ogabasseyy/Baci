import type { NormalizedProduct } from '@/lib/normalize-product';
import { generateBreadcrumbSchema, getProductUrl } from '@/lib/seo-utils';
import { STOREFRONT_PRODUCTS_PER_PAGE } from '@/lib/storefront-pagination';

interface BuildSearchPageSchemasInput {
  businessName: string;
  merchantCurrency: string;
  page: number;
  pageUrl: string;
  products: NormalizedProduct[];
  searchFailed: boolean;
  searchQuery: string;
  storeUrl: string;
  visibleCount: number;
}

export function buildSearchPageSchemas({
  businessName,
  merchantCurrency,
  page,
  pageUrl,
  products,
  searchFailed,
  searchQuery,
  storeUrl,
  visibleCount,
}: BuildSearchPageSchemasInput) {
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: businessName, url: storeUrl },
    { name: 'Search Results', url: pageUrl },
  ]);
  const positionOffset = (page - 1) * STOREFRONT_PRODUCTS_PER_PAGE;
  const searchResultsSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: searchQuery
      ? `Search results for ${searchQuery}`
      : `Search results | ${businessName}`,
    url: pageUrl,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: searchFailed
        ? []
        : products.map((product, index) => {
            const productUrl = `${storeUrl}${getProductUrl(product)}`;

            return {
              '@type': 'ListItem',
              position: positionOffset + index + 1,
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
    numberOfItems: visibleCount,
  };

  return { breadcrumbSchema, searchResultsSchema };
}

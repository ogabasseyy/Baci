import { sanitizeText } from '@/lib/sanitize-core';
import {
  generateBreadcrumbSchema,
  generateMetaDescription,
  getProductUrl,
} from '@/lib/seo-utils';
import type { ProductComparisonMatrix } from '@/lib/storefront-specs/spec-matrix';

interface BreadcrumbItem {
  name: string;
  url: string;
}

interface FAQItem {
  question: string;
  answer: string;
}

interface ProductCompareSchemaProduct {
  id: string;
  name: string;
  slug?: string;
  category?: string | null;
  categories?: { name?: string; slug?: string } | null;
  category_slug?: string | null;
  canonical_url?: string | null;
  price?: number | null;
  availability?: 'InStock' | 'OutOfStock';
  image?: string | null;
  description?: string | null;
}

function normalizeAbsolutePageUrl(pageUrl: string) {
  try {
    return new URL(pageUrl).toString();
  } catch {
    throw new TypeError('compare schema pageUrl must be an absolute URL');
  }
}

interface PriceBandSchemaProduct {
  id: string;
  name: string;
  slug: string;
  category: string;
  category_slug: string;
  price: number;
  availability?: 'InStock' | 'OutOfStock';
  image?: string | null;
  description?: string | null;
}

export function buildComparePageSchemas(input: {
  breadcrumbItems: BreadcrumbItem[];
  faqItems: FAQItem[];
}) {
  return {
    breadcrumb: generateBreadcrumbSchema(input.breadcrumbItems),
    faq: null,
  };
}

export function buildProductCompareItemListSchema(input: {
  pageName: string;
  pageUrl: string;
  currency: string;
  products: ProductCompareSchemaProduct[];
  comparisonMatrix?: ProductComparisonMatrix | null;
}) {
  const pageUrl = normalizeAbsolutePageUrl(input.pageUrl);

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: input.pageName,
    url: pageUrl,
    itemListElement: input.products.map((product, index) => {
      const sanitizedDescription = sanitizeText(product.description || '');
      const availability =
        product.availability === 'OutOfStock'
          ? 'https://schema.org/OutOfStock'
          : product.availability === 'InStock'
            ? 'https://schema.org/InStock'
            : undefined;
      const additionalProperty = input.comparisonMatrix?.flatRows
        .slice(0, 12)
        .map((row) => {
          const value = row.values[index];

          if (!value || value === '—') {
            return null;
          }

          return {
            '@type': 'PropertyValue',
            name: row.label,
            value,
          };
        })
        .filter(
          (
            entry
          ): entry is {
            '@type': 'PropertyValue';
            name: string;
            value: string;
          } => Boolean(entry)
        );

      return {
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Product',
          name: product.name,
          image: product.image ? [product.image] : undefined,
          description: sanitizedDescription || undefined,
          url: new URL(getProductUrl(product), pageUrl).toString(),
          additionalProperty:
            additionalProperty && additionalProperty.length > 0
              ? additionalProperty
              : undefined,
          offers:
            typeof product.price === 'number'
              ? {
                  '@type': 'Offer',
                  price: product.price,
                  priceCurrency: input.currency,
                  ...(availability ? { availability } : {}),
                }
              : undefined,
        },
      };
    }),
  };
}

export function buildPriceBandPageSchemas(input: {
  breadcrumbItems: BreadcrumbItem[];
  pageName: string;
  pageUrl: string;
  currency: string;
  products: PriceBandSchemaProduct[];
}) {
  const pageUrl = normalizeAbsolutePageUrl(input.pageUrl);

  return {
    breadcrumb: generateBreadcrumbSchema(input.breadcrumbItems),
    itemList: {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: input.pageName,
      url: pageUrl,
      itemListElement: input.products.slice(0, 20).map((product, index) => {
        const sanitizedDescription = product.description
          ? generateMetaDescription(
              sanitizeText(product.description || ''),
              120
            )
          : '';
        const availability =
          product.availability === 'OutOfStock'
            ? 'https://schema.org/OutOfStock'
            : 'https://schema.org/InStock';

        return {
          '@type': 'ListItem',
          position: index + 1,
          item: {
            '@type': 'Product',
            name: product.name,
            image: product.image || undefined,
            description: sanitizedDescription || undefined,
            url: new URL(getProductUrl(product), pageUrl).toString(),
            offers: {
              '@type': 'Offer',
              price: product.price,
              priceCurrency: input.currency,
              availability,
            },
          },
        };
      }),
    },
  };
}

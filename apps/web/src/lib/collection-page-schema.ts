import { getProductStockBucket } from '@baci/shared/lib/product-inventory';
import type { CollectionPage, WithContext } from 'schema-dts';
import {
  isExternalPlaceholderImageUrl,
  PLACEHOLDER_IMAGE,
} from './image-utils';
import { generateMetaDescription } from './meta-description';
import { normalizeOgabasseyCdnImageUrl } from './ogabassey-cdn-image-url';
import { getProductUrl } from './product-url';
import { escapeHtml } from './sanitize-core';
import { buildCollectionPageEntityIdentity } from './storefront-entity-id';
import type { MerchantTrustProfile } from './storefront-trust/merchant-trust-profile-types';
import { productManufacturerIdentifiers } from './variant-product-identifiers';

const { normalizeParentProductIdentifiers } = productManufacturerIdentifiers;

export type CollectionPageJsonLdSchema = WithContext<CollectionPage> &
  Record<string, unknown>;

export type CollectionPageProduct = Parameters<typeof getProductUrl>[0] & {
  brand?: string | null;
  description?: string | null;
  gtin?: string | null;
  image?: string | null;
  imageLarge?: string | null;
  low_stock_threshold?: number | string | null;
  manage_stock?: boolean | null;
  mpn?: string | null;
  price: number;
  stock?: number | string | null;
  stock_quantity?: number | string | null;
};

export interface CollectionPageData {
  name: string;
  description?: string;
  url: string;
  products: CollectionPageProduct[];
  merchantName: string;
  currency?: string;
  country?: string;
  trustProfile?: MerchantTrustProfile;
}

export function toAbsoluteSchemaUrl(
  baseUrl: string,
  value?: string | null
): string {
  if (!value) {
    return '';
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return '';
  }
}

function toAbsoluteSchemaImageUrl(
  baseUrl: string,
  ...values: Array<string | null | undefined>
): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const url = new URL(trimmed, baseUrl);
      const isHttpImage = url.protocol === 'http:' || url.protocol === 'https:';
      const absoluteImageUrl = url.toString();
      const isPlaceholder =
        url.pathname === PLACEHOLDER_IMAGE ||
        url.pathname.endsWith(PLACEHOLDER_IMAGE) ||
        isExternalPlaceholderImageUrl(absoluteImageUrl);

      if (isHttpImage && !isPlaceholder) {
        return normalizeOgabasseyCdnImageUrl(absoluteImageUrl);
      }
    } catch {
      // Ignore malformed image candidates and continue to the next fallback.
    }
  }

  return '';
}

function getCollectionProductAvailability(product: {
  manage_stock?: boolean | null;
  stock?: number | string | null;
  stock_quantity?: number | string | null;
  low_stock_threshold?: number | string | null;
}) {
  return getProductStockBucket(product) === 'out_of_stock'
    ? 'https://schema.org/OutOfStock'
    : 'https://schema.org/InStock';
}

/**
 * Generates CollectionPage schema for product listing pages (categories, collections).
 * @see https://schema.org/CollectionPage
 */
export function generateCollectionPageSchema(
  data: CollectionPageData
): CollectionPageJsonLdSchema {
  const safeProducts = data.products
    .flatMap((product) => {
      const imageCandidates = [product.imageLarge, product.image];
      const productImage = toAbsoluteSchemaImageUrl(
        data.url,
        ...imageCandidates
      );

      return productImage ? [{ product, productImage }] : [];
    })
    .slice(0, 20);
  const absolutePageUrl = toAbsoluteSchemaUrl(data.url, data.url);
  const currency = data.currency || 'NGN';

  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: escapeHtml(data.name),
    description: data.description ? escapeHtml(data.description) : undefined,
    ...buildCollectionPageEntityIdentity(absolutePageUrl),
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: safeProducts.length,
      itemListElement: safeProducts.map(({ product, productImage }, index) => {
        const productUrl = toAbsoluteSchemaUrl(
          data.url,
          getProductUrl(product)
        );
        const identifiers = normalizeParentProductIdentifiers(product);

        return {
          '@type': 'ListItem',
          position: index + 1,
          item: {
            '@type': 'Product',
            name: escapeHtml(product.name),
            description: product.description
              ? escapeHtml(generateMetaDescription(product.description, 100))
              : undefined,
            image: [productImage],
            url: productUrl || undefined,
            brand: {
              '@type': 'Brand',
              name: escapeHtml(product.brand || data.merchantName),
            },
            ...(identifiers.gtin && { gtin: escapeHtml(identifiers.gtin) }),
            ...(identifiers.mpn && { mpn: escapeHtml(identifiers.mpn) }),
            offers: {
              '@type': 'Offer',
              price: product.price,
              priceCurrency: currency,
              availability: getCollectionProductAvailability(product),
              url: productUrl || undefined,
            },
          },
        };
      }),
    },
  };
}

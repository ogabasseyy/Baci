import type { WebPage } from 'schema-dts';
import type { JsonLdData } from '@/components/seo/json-ld';

interface StorefrontContentPageSchemaInput {
  baseUrl: string;
  businessName: string;
  description: string;
  logoUrl?: string | null;
  pageName: string;
  path: `/${string}`;
  updatedAt?: string | null;
}

export function buildStorefrontContentPageSchema({
  baseUrl,
  businessName,
  description,
  logoUrl,
  pageName,
  path,
  updatedAt,
}: StorefrontContentPageSchemaInput): JsonLdData<WebPage> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${pageName} | ${businessName}`,
    url: `${baseUrl}${path}`,
    description,
    isPartOf: {
      '@type': 'WebSite',
      name: businessName,
      url: baseUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: businessName,
      url: baseUrl,
      ...(logoUrl && { logo: logoUrl }),
    },
    inLanguage: 'en',
    ...(updatedAt ? { dateModified: updatedAt } : {}),
  };
}

import type { BreadcrumbList, CollectionPage, FAQPage } from 'schema-dts';
import type { JsonLdData } from '@/components/seo/json-ld';
import {
  generateBreadcrumbSchema,
  generateCollectionPageSchema,
  generateFAQSchema,
} from '@/lib/seo-utils';
import type { CategoryHubModel } from '@/lib/storefront-category/category-hub-types';
import type { toCollectionSchemaProduct } from './category-page-content-helpers';

interface CategoryPageContentSchemaInput {
  baseUrl: string;
  canonicalCategoryUrl: string;
  categoryName: string;
  country: string | null | undefined;
  currencyCode: string;
  hubContent: CategoryHubModel;
  isCollection: boolean;
  merchantBusinessName: string;
  paginatedCategoryUrl: string;
  parent: { name: string; slug: string } | null;
  products: ReturnType<typeof toCollectionSchemaProduct>[];
  seoPageName?: string;
}

export interface CategoryPageContentSchemas {
  breadcrumbSchema: JsonLdData<BreadcrumbList>;
  collectionSchema: JsonLdData<CollectionPage>;
  faqSchema: JsonLdData<FAQPage> | null;
}

export function buildCategoryPageContentSchemas({
  baseUrl,
  canonicalCategoryUrl,
  categoryName,
  country,
  currencyCode,
  hubContent,
  isCollection,
  merchantBusinessName,
  paginatedCategoryUrl,
  parent,
  products,
  seoPageName,
}: CategoryPageContentSchemaInput): CategoryPageContentSchemas {
  const collectionSchema = generateCollectionPageSchema({
    name: seoPageName ?? categoryName,
    description: hubContent.intro.description,
    url: paginatedCategoryUrl,
    products,
    merchantName: merchantBusinessName,
    country: country || 'NG',
    currency: currencyCode,
  }) as unknown as JsonLdData<CollectionPage>;

  const breadcrumbItems = [{ name: merchantBusinessName, url: baseUrl }];

  if (!isCollection && parent) {
    breadcrumbItems.push({
      name: parent.name,
      url: `${baseUrl}/${parent.slug}`,
    });
  }

  breadcrumbItems.push({
    name: seoPageName ?? categoryName,
    url: canonicalCategoryUrl,
  });

  const breadcrumbSchema = generateBreadcrumbSchema(
    breadcrumbItems
  ) as unknown as JsonLdData<BreadcrumbList>;
  const faqSchema =
    hubContent.faqItems.length > 0
      ? (generateFAQSchema(
          hubContent.faqItems
        ) as unknown as JsonLdData<FAQPage>)
      : null;

  return { breadcrumbSchema, collectionSchema, faqSchema };
}

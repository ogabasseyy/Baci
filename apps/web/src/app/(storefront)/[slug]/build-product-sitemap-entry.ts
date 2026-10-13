import type { MetadataRoute } from 'next';
import { getValidatedProductUrl } from '@/lib/seo-utils';
import { resolveStorefrontProductCategory } from '@/lib/storefront-product-category-precedence';

export interface ProductWithCategory {
  id: string;
  name?: string | null;
  slug: string | null;
  category: string | null;
  canonical_url: string | null;
  images: unknown;
  updated_at: string | null;
  categories: { is_active?: boolean | null; slug: string | null } | null;
  product_categories?: Array<{
    category_id?: string | null;
    categories: { is_active?: boolean | null; slug: string | null } | null;
  }> | null;
}

export function buildProductSitemapEntry({
  product,
  storeUrl,
}: {
  product: ProductWithCategory;
  storeUrl: string;
}): MetadataRoute.Sitemap[number] {
  const normalizedJoinedCategory = resolveStorefrontProductCategory(product);
  const url = getValidatedProductUrl(
    {
      id: product.id,
      slug: product.slug ?? undefined,
      name: product.slug ? (product.name ?? '') : product.id,
      category: product.category,
      categories: normalizedJoinedCategory,
      canonical_url: product.canonical_url,
    },
    storeUrl
  );
  const images: string[] = [];

  if (Array.isArray(product.images)) {
    for (const image of product.images) {
      const imageUrl =
        typeof image === 'string'
          ? image
          : (image as Record<string, unknown>)?.url;
      if (typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
        images.push(imageUrl);
      }
    }
  }

  return {
    url,
    lastModified: product.updated_at ? new Date(product.updated_at) : undefined,
    changeFrequency: 'weekly',
    priority: 0.8,
    ...(images.length > 0 && { images }),
  };
}

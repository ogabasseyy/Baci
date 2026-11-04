import type { MetadataRoute } from 'next';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import type { createAnonClient } from '@/lib/supabase/anon';

export type CommercialSupportCategorySitemapEntry =
  MetadataRoute.Sitemap[number] & {
    categorySlug: string;
  };

type CommercialSupportCategorySitemapContext = {
  merchantId: string;
  storeUrl: string;
  supabase: ReturnType<typeof createAnonClient>;
};

export async function getCommercialSupportCategorySitemapEntries({
  merchantId,
  storeUrl,
  supabase,
}: CommercialSupportCategorySitemapContext): Promise<
  CommercialSupportCategorySitemapEntry[]
> {
  const { data: categories, error } = await supabase
    .from('categories')
    .select('slug, updated_at')
    .eq('merchant_id', merchantId)
    .eq('is_active', true);

  if (error) {
    throw error;
  }
  if (!categories) {
    throw new Error(`Failed to load category sitemap for ${merchantId}`);
  }

  return categories.flatMap((category) => {
    const slug = category.slug?.trim();
    if (
      !slug ||
      slug.includes('/') ||
      slug.includes(' ') ||
      !evaluateStorefrontSlugSafety(slug).safe
    ) {
      return [];
    }
    return [
      {
        url: `${storeUrl}/${slug}`,
        categorySlug: slug,
        lastModified: category.updated_at
          ? new Date(category.updated_at)
          : undefined,
        changeFrequency: 'daily' as const,
        priority: 0.7,
      },
    ];
  });
}

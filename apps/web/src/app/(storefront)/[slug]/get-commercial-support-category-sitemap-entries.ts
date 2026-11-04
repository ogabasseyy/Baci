import type { MetadataRoute } from 'next';
import type { createAnonClient } from '@/lib/supabase/anon';

type CommercialSupportCategorySitemapContext = {
  merchantId: string;
  storeUrl: string;
  supabase: ReturnType<typeof createAnonClient>;
};

export async function getCommercialSupportCategorySitemapEntries({
  merchantId,
  storeUrl,
  supabase,
}: CommercialSupportCategorySitemapContext): Promise<MetadataRoute.Sitemap> {
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
    if (!slug) {
      return [];
    }
    return [
      {
        url: `${storeUrl}/${slug}`,
        lastModified: category.updated_at
          ? new Date(category.updated_at)
          : undefined,
        changeFrequency: 'daily' as const,
        priority: 0.7,
      },
    ];
  });
}

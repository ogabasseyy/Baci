import { cacheLife, cacheTag } from 'next/cache';
import { getMerchantStrict, getPublicSupabaseClient } from '@/lib/cached-data';
import { filterPublicBlogCategories } from '@/lib/public-blog-content-quality';
import { buildStoreUrl } from '@/lib/store-url';
import { getBlogPostsMerchantCacheTag } from '@/lib/tenant-cache-tags';
import {
  buildBlogCategorySchemaUrl,
  findBlogCategoryLabelBySlug,
} from './blog-category-routing';

interface PublicBlogCategoryRow {
  category: string | null;
}

export interface ResolvedBlogCategoryHub {
  canonicalUrl: string;
  categoryLabel: string;
}

export async function resolveBlogCategoryHub(
  slug: string,
  categorySlug: string
): Promise<ResolvedBlogCategoryHub | null> {
  'use cache';
  const lookupKey = slug.toLowerCase();
  cacheLife('merchant');
  cacheTag('blog-posts', `blog-category-hub-${lookupKey}`);

  const merchant = await getMerchantStrict(lookupKey);
  if (!merchant) {
    return null;
  }
  cacheTag(getBlogPostsMerchantCacheTag(merchant.id));

  if (!merchant.feature_settings?.blog_enabled) {
    return null;
  }

  const supabase = getPublicSupabaseClient();
  const { data: categories, error } = await supabase.rpc(
    'get_public_blog_categories',
    { p_merchant_id: merchant.id }
  );
  if (error) {
    console.error('Failed to load blog categories for category hub', {
      merchantId: merchant.id,
      error,
    });
    throw new Error('Failed to load blog categories for category hub', {
      cause: error,
    });
  }

  const categoryRows = (categories ?? []) as PublicBlogCategoryRow[];
  const publicCategories = filterPublicBlogCategories(
    categoryRows.map((entry) => entry.category)
  );
  const categoryLabel = findBlogCategoryLabelBySlug(
    publicCategories,
    categorySlug
  );
  if (!categoryLabel) {
    return null;
  }

  return {
    canonicalUrl: buildBlogCategorySchemaUrl(
      buildStoreUrl(merchant),
      categoryLabel
    ),
    categoryLabel,
  };
}

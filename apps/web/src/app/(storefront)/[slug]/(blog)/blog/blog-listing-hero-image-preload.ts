import 'server-only';
import { getBlogListingImageSrc } from '@/components/storefront/ogabassey/pages/blog-listing-image-src';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { preloadBlogListingFeaturedImage } from './blog-listing-featured-image-preload';

interface BlogListingHeroPost {
  author_name?: string | null;
  category?: string | null;
  excerpt?: string | null;
  featured?: boolean;
  featured_image_url?: string | null;
  id?: string | number;
  published_at?: string | null;
  reading_time_minutes?: number | null;
  slug?: string | null;
  title?: string | null;
}

interface BlogListingHeroImagePreloadOptions {
  category?: string;
  posts: readonly BlogListingHeroPost[];
  searchQuery?: string;
  templateId?: string | null;
}

export function getBlogListingHeroPost<T extends BlogListingHeroPost>(
  posts: readonly T[]
): T | undefined {
  return posts.find((post) => post.featured === true) ?? posts[0];
}

function isRootBlogCategory(category?: string): boolean {
  return category === undefined || category === 'All';
}

export function preloadOgabasseyRootBlogListingHeroImage({
  category,
  posts,
  searchQuery,
  templateId,
}: BlogListingHeroImagePreloadOptions): void {
  if (
    templateId !== OGABASSEY_TEMPLATE_ID ||
    !isRootBlogCategory(category) ||
    searchQuery
  ) {
    return;
  }

  preloadBlogListingFeaturedImage(
    getBlogListingImageSrc(getBlogListingHeroPost(posts)?.featured_image_url)
  );
}

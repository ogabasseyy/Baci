import { getBlogListingImageSrc } from '@/components/storefront/ogabassey/pages/blog-listing-image-src';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { getCachedBlogListing } from '@/lib/cached-data';
import { buildStoreUrl } from '@/lib/store-url';
import { BlogListingFeaturedHeroView } from './blog-listing-featured-hero-view';
import { buildBlogListingFeaturedStory } from './blog-listing-featured-story';
import {
  getBlogListingHeroPost,
  preloadOgabasseyRootBlogListingHeroImage,
} from './blog-listing-hero-image-preload';

interface BlogListingStaticHeroProps {
  params: Promise<{ slug: string }>;
}

export async function BlogListingStaticHero({
  params,
}: BlogListingStaticHeroProps) {
  const { slug } = await params;
  const data = await getCachedBlogListing(slug);

  if (!data || data.merchant.template_id !== OGABASSEY_TEMPLATE_ID) {
    return null;
  }

  const heroPost = getBlogListingHeroPost(data.posts);
  if (!heroPost?.slug || !heroPost.title) {
    return null;
  }

  preloadOgabasseyRootBlogListingHeroImage({
    posts: data.posts,
    templateId: data.merchant.template_id,
  });

  const { featuredPost, publishedDateLabel } = buildBlogListingFeaturedStory(
    {
      id: heroPost.id ?? heroPost.slug,
      title: heroPost.title,
      slug: heroPost.slug,
      excerpt: heroPost.excerpt,
      category: heroPost.category,
      author_name: heroPost.author_name,
      published_at: heroPost.published_at,
      featured_image_url: heroPost.featured_image_url,
      reading_time_minutes: heroPost.reading_time_minutes,
    },
    data.merchant.business_name
  );

  return (
    <BlogListingFeaturedHeroView
      basePath={buildStoreUrl(data.merchant)}
      featuredPost={featuredPost}
      imageSrc={getBlogListingImageSrc(featuredPost.featured_image_url)}
      publishedDateLabel={publishedDateLabel}
    />
  );
}
